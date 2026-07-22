import {
  FLUX_WGSL, UPDATE_WGSL, PHI_WGSL, TRANSPORT_WGSL, STAMP_WGSL, STATS_WGSL,
  MAX_GRAINS, MAX_SEEDS, SEED_STRIDE, P2, SOLVER, shaderModule,
} from "./shaders";
import { DEFAULT_UM_PER_CELL } from "./units";

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
  // scenarios
  scen: number;       // 0 none, 1 bridgman, 2 weld
  gradG: number;      // bridgman thermal gradient (T per unit length)
  pullV: number;      // bridgman pull speed (units per unit time)
  weldX: number;      // weld source position (cells)
  weldY: number;
  weldPow: number;
  weldSig: number;    // gaussian sigma (cells)
  // alloy
  alloyOn: number;    // 0/1
  c0: number;
  mLiq: number;
  kPart: number;
  dSol: number;
  // crystallography / material identity
  twinProb: number;   // per-claim growth-twin probability (0 = off)
  meltGlow: number;   // display-only incandescence scale (1 = steel-bright)
  // set-point cooling (scen 3): the lab's thermal programs and the cast logo
  holdT: number;      // set-point the charge relaxes toward
  holdRate: number;   // Newtonian relax rate toward the set-point
  facet: number;      // 0 smooth cos anisotropy · 1 regularized-cusp (faceted)
  moldT: number;      // temperature the mould wall holds (age sentinel -1)
  // ---- v5.0 Phase Q: the quantitative solver. Every one of these is a no-op
  // at its default, so the Kobayashi path is bit-identical to what shipped.
  solver: number;     // SOLVER.KOB | SOLVER.QUANT
  lambda: number;     // KR coupling — W₀/d₀ = λ/a₁ (quantitative only)
  dTherm: number;     // dimensionless thermal diffusivity (1 = Kobayashi)
  atCoef: number;     // anti-trapping coefficient (0 = current off)
  frozenT: number;    // 1 = temperature imposed by the scenario, never solved
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
  meltGlow: 1.0,
  holdT: 0,
  holdRate: 0,
  facet: 0,
  moldT: 0.06,
  solver: SOLVER.KOB,
  lambda: 3.0,
  dTherm: 1.0,
  atCoef: 0,
  frozenT: 0,
};

export interface StatsResult {
  fracSolid: number;
  grainCount: number;
  meanAreaPx: number;
  astm: number | null;
  interfaceT: number;
  diamsUm: number[];
  probeT: number | null;   // temperature at the cooling-curve probe cell
  probePhi: number | null;
  /** mean temperature of the remaining liquid, or null once fully solid */
  meanLiqT: number | null;
  /** area-weighted grain-orientation histogram over [0, 2pi/j), 18 bins */
  oriRose: number[];
  /**
   * total solute in the domain, in model concentration units × cells. The
   * quantitative alloy model's conservation gate reads this: the anti-trapping
   * current is a face sum precisely so that this number is flat.
   */
  soluteSum: number;
}

// (physical scale lives in units.ts — the solver carries only `umPerCell`, set
// from there, because µm-per-cell is the anchor and the domain width is derived)

interface Seed { x: number; y: number; r: number; id: number; dTact: number }

export class Simulation {
  readonly device: GPUDevice;
  n: number;
  params: PhysParams;
  frame = 0;
  simTime = 0;
  dir = 0;
  nextId = 1;
  /** bridgman frame anchor: reference-isotherm x (units); advanced by main loop */
  frontX = 0;
  /** cooling-curve probe cell, or null = off */
  probe: { x: number; y: number } | null = null;
  /**
   * Physical model resolution. This is the length ANCHOR (see units.ts): the
   * domain is `n × umPerCell` wide, not the other way round. The previous code
   * asserted a fixed 1 mm domain and derived the pitch, which made the same
   * dendrite measure four different sizes at four different grid sizes.
   */
  umPerCell = DEFAULT_UM_PER_CELL;
  /**
   * Run the solidification step as FLUX -> PHI -> TRANSPORT instead of the fused
   * FLUX -> UPDATE. Identical physics — the two shapes are composed from the same
   * WGSL fragments — but the split writes phi^{n+1} and dphi/dt into `phiAux`,
   * which is what a face-evaluated anti-trapping current needs. Off by default:
   * the fused path costs one dispatch fewer and is what ships until the
   * quantitative solver lands.
   *
   * The quantitative solver forces it on regardless (`splitNow`): its
   * anti-trapping current lives in the split shape only.
   */
  splitPasses = false;

  /** the shape this step will actually run — QUANT has no fused variant */
  private get splitNow() { return this.splitPasses || this.params.solver === SOLVER.QUANT; }

  private stateTex: GPUTexture[] = [];
  private grainTex: GPUTexture[] = [];
  private fluxTex!: GPUTexture;
  /** rg32float (phi^{n+1}, dphi/dt) — single-buffered: written and consumed
   *  inside one substep, never read across the ping-pong flip */
  private phiAuxTex!: GPUTexture;
  private paramBuf!: GPUBuffer;
  private theta0Buf!: GPUBuffer;
  private twinCtrBuf!: GPUBuffer;
  private seedBuf!: GPUBuffer;
  private statsBuf!: GPUBuffer;
  private statsStaging!: GPUBuffer;
  private theta0CPU = new Float32Array(MAX_GRAINS);

  private fluxPipe!: GPUComputePipeline;
  private updatePipe!: GPUComputePipeline;
  private phiPipe!: GPUComputePipeline;
  private transportPipe!: GPUComputePipeline;
  private stampPipe!: GPUComputePipeline;
  private statsPipe!: GPUComputePipeline;
  private fluxBG: GPUBindGroup[] = [];
  private updateBG: GPUBindGroup[] = [];
  private phiBG: GPUBindGroup[] = [];
  private transportBG: GPUBindGroup[] = [];
  private stampBG: GPUBindGroup[] = [];
  private statsBG: GPUBindGroup[] = [];

  private pendingSeeds: Seed[] = [];
  private pendingQuench = 0;
  private statsInFlight = false;
  private paramData = new ArrayBuffer(P2.BYTES);
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
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.COPY_SRC,
    });
    this.stateTex = [d.createTexture(texDesc("rgba32float")), d.createTexture(texDesc("rgba32float"))];
    this.grainTex = [d.createTexture(texDesc("r32uint")), d.createTexture(texDesc("r32uint"))];
    this.fluxTex = d.createTexture(texDesc("rgba32float"));
    this.phiAuxTex = d.createTexture(texDesc("rg32float"));

    this.paramBuf = d.createBuffer({ size: P2.BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.theta0Buf = d.createBuffer({ size: MAX_GRAINS * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
    this.twinCtrBuf = d.createBuffer({ size: 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.seedBuf = d.createBuffer({ size: MAX_SEEDS * SEED_STRIDE * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const statsSize = (8 + MAX_GRAINS) * 4;
    this.statsBuf = d.createBuffer({ size: statsSize, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
    // staging carries the stats block plus a theta0 snapshot (for the texture rose)
    this.statsStaging = d.createBuffer({ size: statsSize + MAX_GRAINS * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });

    const mk = (code: string, label = "pass") =>
      d.createComputePipeline({ layout: "auto", compute: { module: shaderModule(d, code, label), entryPoint: "main" } });
    this.fluxPipe = mk(FLUX_WGSL);
    this.updatePipe = mk(UPDATE_WGSL);
    this.phiPipe = mk(PHI_WGSL);
    this.transportPipe = mk(TRANSPORT_WGSL);
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
          { binding: 6, resource: { buffer: this.theta0Buf } },
          { binding: 7, resource: { buffer: this.twinCtrBuf } },
        ],
      });
      this.phiBG[dir] = d.createBindGroup({
        layout: this.phiPipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.paramBuf } },
          { binding: 1, resource: s },
          { binding: 2, resource: this.fluxTex.createView() },
          { binding: 3, resource: this.phiAuxTex.createView() },
        ],
      });
      this.transportBG[dir] = d.createBindGroup({
        layout: this.transportPipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.paramBuf } },
          { binding: 1, resource: s },
          { binding: 2, resource: g },
          { binding: 3, resource: this.phiAuxTex.createView() },
          { binding: 4, resource: so },
          { binding: 5, resource: go },
          { binding: 6, resource: { buffer: this.theta0Buf } },
          { binding: 7, resource: { buffer: this.twinCtrBuf } },
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
    const state = new Float32Array(n * n * 4);
    const c0 = this.params.alloyOn ? this.params.c0 : 0;
    for (let i = 0; i < n * n; i++) {
      state[i * 4 + 1] = tFar;
      state[i * 4 + 2] = c0;
    }
    for (const t of this.stateTex)
      this.device.queue.writeTexture({ texture: t }, state, { bytesPerRow: n * 16 }, [n, n]);
    const zeros = new Uint32Array(n * n);
    for (const t of this.grainTex)
      this.device.queue.writeTexture({ texture: t }, zeros, { bytesPerRow: n * 4 }, [n, n]);
    this.dir = 0;
    this.frame = 0;
    this.simTime = 0;
    this.nextId = 1;
    this.frontX = 1.0;
    this.pendingSeeds = [];
    this.theta0CPU.fill(0);
    this.device.queue.writeBuffer(this.theta0Buf, 0, this.theta0CPU);
    // GPU twins allocate ids downward from the top of the range
    this.device.queue.writeBuffer(this.twinCtrBuf, 0, new Uint32Array([MAX_GRAINS - 1]));
  }

  /**
   * cast into a mold: mask=1 cells become superheated liquid (the pour),
   * mask=0 cells become cold solid mold sharing one grain. Age sentinel:
   * mold cells stay -1 forever, so the CAST lens can tell cast metal from
   * mold whatever its grain id.
   *
   * NOTE — currently uncalled. This is the mask-reset mechanism the 2D side
   * needs for real mould geometry (today only the volume rasterizes a shell,
   * which is why the lab's "mould walls" control hides in 2D). Kept, not
   * deleted: the shaped-mould work is what wires it up.
   */
  resetMold(mask: Uint8Array, tLiquid = 1.15, tMold = 0.06) {
    const n = this.n;
    const state = new Float32Array(n * n * 4);
    const ids = new Uint32Array(n * n);
    for (let i = 0; i < n * n; i++) {
      const inside = mask[i] === 1;
      state[i * 4] = inside ? 0 : 1;
      state[i * 4 + 1] = inside ? tLiquid : tMold;
      state[i * 4 + 3] = inside ? 0 : -1;
    }
    for (let i = 0; i < n * n; i++) if (mask[i] !== 1) ids[i] = 1;
    for (const t of this.stateTex)
      this.device.queue.writeTexture({ texture: t }, state, { bytesPerRow: n * 16 }, [n, n]);
    for (const t of this.grainTex)
      this.device.queue.writeTexture({ texture: t }, ids, { bytesPerRow: n * 4 }, [n, n]);
    this.dir = 0;
    this.frame = 0;
    this.simTime = 0;
    this.frontX = 1.0;
    this.pendingSeeds = [];
    this.theta0CPU.fill(0);
    this.theta0CPU[1] = Math.random() * (2 * Math.PI / this.params.aniMode);
    this.nextId = 2;
    this.device.queue.writeBuffer(this.theta0Buf, 0, this.theta0CPU);
    this.device.queue.writeBuffer(this.twinCtrBuf, 0, new Uint32Array([MAX_GRAINS - 1]));
  }

  /**
   * queue a nucleus; x, y in grid cells; returns assigned grain id.
   * dTact = activation undercooling: the site only fires where the melt is
   * colder than its local liquidus by more than this (default -9 = always,
   * for taps and chill walls; the nucleation model passes a distribution).
   */
  addSeed(x: number, y: number, r = 4, theta0?: number, dTact = -9): number {
    let id = this.nextId++;
    if (id >= MAX_GRAINS) { this.nextId = 2; id = 1; }
    const th = theta0 ?? Math.random() * (2 * Math.PI / this.params.aniMode);
    this.theta0CPU[id] = th;
    this.device.queue.writeBuffer(this.theta0Buf, id * 4, this.theta0CPU, id, 1);
    this.pendingSeeds.push({ x, y, r, id, dTact });
    return id;
  }

  /** one-shot uniform temperature drop (ice-brine plunge); stacks if pressed again */
  quench(dT = 0.25) { this.pendingQuench += dT; }

  /**
   * stamp a twinned nucleus: two adjacent seeds sharing a site, rotated by
   * pi/j into twin registry. In 6-fold this grows the rare 12-branched
   * snowflake; in 4-fold, the 2D analog of a feathery twinned grain.
   */
  addTwinSeed(x: number, y: number, r = 4) {
    const th = Math.random() * (2 * Math.PI / this.params.aniMode);
    const ang = Math.random() * Math.PI * 2;
    const off = r * 0.45;
    this.addSeed(x - Math.cos(ang) * off, y - Math.sin(ang) * off, r, th);
    this.addSeed(x + Math.cos(ang) * off, y + Math.sin(ang) * off, r, th + Math.PI / this.params.aniMode);
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
    u[P2.n] = this.n;
    u[P2.frame] = this.frame;
    f[P2.dx] = p.dx; f[P2.dt] = p.dt;
    f[P2.epsBar] = p.epsBar; f[P2.delta] = p.delta;
    f[P2.aniMode] = p.aniMode; f[P2.tau] = p.tau;
    f[P2.alpha] = p.alpha; f[P2.gamma] = p.gamma;
    f[P2.latent] = p.latent; f[P2.noiseAmp] = p.noiseAmp;
    f[P2.tFar] = p.tFar; f[P2.coolRate] = p.coolRate; f[P2.heatIn] = p.heatIn;
    u[P2.seedCount] = seedCount;
    f[P2.time] = this.simTime;
    u[P2.scen] = p.scen;
    f[P2.gradG] = p.gradG;
    f[P2.frontX] = this.frontX;
    f[P2.weldX] = p.weldX; f[P2.weldY] = p.weldY;
    f[P2.weldPow] = p.weldPow; f[P2.weldSig] = p.weldSig;
    u[P2.alloyOn] = p.alloyOn;
    f[P2.c0] = p.c0; f[P2.mLiq] = p.mLiq; f[P2.kPart] = p.kPart; f[P2.dSol] = p.dSol;
    f[P2.quenchDT] = this.pendingQuench;
    f[P2.twinProb] = p.twinProb;
    u[P2.idFloor] = this.nextId;
    u[P2.probeX] = this.probe ? Math.round(this.probe.x) : 0xffffffff;
    u[P2.probeY] = this.probe ? Math.round(this.probe.y) : 0xffffffff;
    f[P2.holdT] = p.holdT;
    f[P2.holdRate] = p.holdRate;
    f[P2.facet] = p.facet;
    f[P2.moldT] = p.moldT;
    u[P2.solver] = p.solver;
    f[P2.lambda] = p.lambda;
    f[P2.dTherm] = p.dTherm;
    f[P2.atCoef] = p.atCoef;
    u[P2.frozenT] = p.frozenT;
    this.device.queue.writeBuffer(this.paramBuf, 0, this.paramData);
  }

  private dispatch(pass: GPUComputePassEncoder) {
    const wg = Math.ceil(this.n / 8);
    pass.dispatchWorkgroups(wg, wg);
  }

  /** substeps one command buffer is allowed to carry at this grid size */
  private get stepCap() { return Math.max(1, Math.floor(1.6e8 / (this.n * this.n))); }

  /**
   * Advance the field by `substeps` explicit Euler steps (0 = stamp seeds
   * only, so taps show up while paused). Single command submission; skips
   * (returns 0) while the GPU is >= 2 frames behind.
   */
  step(substeps: number): number {
    if (this.busy) return 0;
    const steps = this.submit(substeps);
    if (steps < 0) return 0;
    this.inFlight++;
    this.device.queue.onSubmittedWorkDone().then(() => { this.inFlight = Math.max(0, this.inFlight - 1); });
    return steps;
  }

  /**
   * Advance by EXACTLY `substeps`, awaiting the GPU between submissions.
   *
   * `step()` is frame-paced: it refuses while the queue is two submissions deep,
   * so a caller that drives it from rAF gets an unpredictable number of
   * substeps per wall-clock second. That is correct for an interactive app and
   * fatal for a measurement — it is postmortem #6, and it is how a "restored"
   * grain-refinement result got written up twice before running under load and
   * evaporating. Anything derived from HOW FAR a cast got — tip velocity, sites
   * fired, ticks elapsed — must come through here, where the amount of physics
   * delivered is an argument rather than a race.
   */
  async stepSync(substeps: number): Promise<number> {
    if (substeps <= 0) {
      this.submit(0);
      await this.device.queue.onSubmittedWorkDone();
      return 0;
    }
    let done = 0;
    while (done < substeps) {
      const got = this.submit(Math.min(this.stepCap, substeps - done));
      await this.device.queue.onSubmittedWorkDone();
      if (got <= 0) break;
      done += got;
    }
    return done;
  }

  /**
   * Encode and submit one command buffer. Returns the substeps advanced, or -1
   * when there was nothing at all to do. Shared by `step` and `stepSync` so the
   * pass order, the stamp interaction and the ping-pong bookkeeping exist once.
   */
  private submit(substeps: number): number {
    const d = this.device;
    const steps = Math.min(substeps, this.stepCap);

    let seedCount = 0;
    if (this.pendingSeeds.length > 0) {
      const batch = this.pendingSeeds.splice(0, MAX_SEEDS);
      const sd = new Float32Array(batch.length * SEED_STRIDE);
      batch.forEach((s, i) => {
        const b = i * SEED_STRIDE;
        sd[b] = s.x; sd[b + 1] = s.y; sd[b + 2] = s.r; sd[b + 3] = s.id; sd[b + 4] = s.dTact;
      });
      d.queue.writeBuffer(this.seedBuf, 0, sd);
      seedCount = batch.length;
    }
    const doStamp = seedCount > 0 || this.pendingQuench !== 0;
    if (steps <= 0 && !doStamp) return -1;
    this.frame++;
    // bridgman frame advances with sim time
    if (this.params.scen === 1) this.frontX = 1.0 + this.params.pullV * this.simTime;
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
    const split = this.splitNow;
    for (let i = 0; i < steps; i++) {
      pass.setPipeline(this.fluxPipe);
      pass.setBindGroup(0, this.fluxBG[dir]);
      this.dispatch(pass);
      if (split) {
        // WebGPU inserts an implicit barrier between dispatches in one compute
        // pass, which is what the existing FLUX -> UPDATE chain already relies
        // on; PHI -> TRANSPORT is the same contract with one more link.
        pass.setPipeline(this.phiPipe);
        pass.setBindGroup(0, this.phiBG[dir]);
        this.dispatch(pass);
        pass.setPipeline(this.transportPipe);
        pass.setBindGroup(0, this.transportBG[dir]);
        this.dispatch(pass);
      } else {
        pass.setPipeline(this.updatePipe);
        pass.setBindGroup(0, this.updateBG[dir]);
        this.dispatch(pass);
      }
      dir = 1 - dir;
    }
    pass.end();
    d.queue.submit([enc.finish()]);
    this.dir = dir;
    this.simTime += steps * this.params.dt;
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
    enc.copyBufferToBuffer(this.theta0Buf, 0, this.statsStaging, this.statsBuf.size, MAX_GRAINS * 4);
    d.queue.submit([enc.finish()]);
    try {
      await this.statsStaging.mapAsync(GPUMapMode.READ);
    } catch {
      this.statsInFlight = false;
      return null;
    }
    const raw = this.statsStaging.getMappedRange().slice(0);
    const data = new Uint32Array(raw, 0, 8 + MAX_GRAINS);
    const thetas = new Float32Array(raw, (8 + MAX_GRAINS) * 4, MAX_GRAINS);
    this.statsStaging.unmap();
    this.statsInFlight = false;

    const total = this.n * this.n;
    const solid = data[0];
    const interf = data[1];
    const interfT = interf > 0 ? data[2] / 1000 / interf : 0;
    const probeT = this.probe ? data[4] / 1000 - 1 : null;
    const probePhi = this.probe ? data[5] / 1000 : null;
    const liqCount = data[3];
    const meanLiqT = liqCount > 0 ? data[6] / 500 / liqCount - 1 : null;
    const soluteSum = data[7] / 200;
    const minPx = Math.max(20, this.n * this.n * 1e-5);
    const umPerPx = this.umPerCell;
    const diams: number[] = [];
    const period = 2 * Math.PI / this.params.aniMode;
    const oriRose = new Array<number>(18).fill(0);
    let areaSum = 0;
    for (let i = 1; i < MAX_GRAINS; i++) {
      const c = data[8 + i];
      if (c > minPx) {
        areaSum += c;
        diams.push(2 * Math.sqrt(c / Math.PI) * umPerPx);
        const th = ((thetas[i] % period) + period) % period;
        oriRose[Math.min(17, Math.floor((th / period) * 18))] += c;
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
    return { fracSolid: solid / total, grainCount: count, meanAreaPx, astm, interfaceT: interfT, diamsUm: diams, probeT, probePhi, meanLiqT, oriRose, soluteSum };
  }

  /**
   * One-shot readback of the whole state texture over a band of rows —
   * (phi, T, c, age) interleaved, `h * n * 4` floats, row-major from `y0`.
   *
   * Full rows rather than a rectangle because `copyTextureToBuffer` wants a
   * bytesPerRow that is a multiple of 256, and `n * 16` already is at every grid
   * size the app offers; a sub-width copy would need padding arithmetic for no
   * saving worth having. This is the primitive under both the SDAS ruler and the
   * tip-shape fit the quantitative gates measure against.
   */
  async readRows(y0: number, h: number): Promise<Float32Array | null> {
    const n = this.n;
    y0 = Math.min(n - 1, Math.max(0, Math.floor(y0)));
    h = Math.min(n - y0, Math.max(1, Math.ceil(h)));
    const bpr = n * 16; // multiple of 256 for all grid sizes
    const buf = this.device.createBuffer({ size: bpr * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = this.device.createCommandEncoder();
    enc.copyTextureToBuffer(
      { texture: this.stateTex[this.dir], origin: { x: 0, y: y0 } },
      { buffer: buf, bytesPerRow: bpr },
      { width: n, height: h });
    this.device.queue.submit([enc.finish()]);
    try {
      await buf.mapAsync(GPUMapMode.READ);
    } catch {
      buf.destroy();
      return null;
    }
    const data = new Float32Array(buf.getMappedRange().slice(0));
    buf.unmap();
    buf.destroy();
    return data;
  }

  /**
   * one-shot readback of phi sampled along a line (grid coords) — the SDAS
   * ruler's linear-intercept trace. Copies only the rows the line spans.
   */
  async readLine(ax: number, ay: number, bx: number, by: number, samples = 400): Promise<Float32Array | null> {
    const n = this.n;
    const cl = (v: number) => Math.min(n - 1, Math.max(0, v));
    ax = cl(ax); ay = cl(ay); bx = cl(bx); by = cl(by);
    const y0 = Math.floor(Math.min(ay, by));
    const rows = Math.ceil(Math.max(ay, by)) - y0 + 1;
    const data = await this.readRows(y0, rows);
    if (!data) return null;
    const out = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      const t = i / (samples - 1);
      const x = Math.round(ax + (bx - ax) * t);
      const y = Math.round(ay + (by - ay) * t);
      out[i] = data[((y - y0) * n + x) * 4];
    }
    return out;
  }
}
