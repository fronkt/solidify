// TRUE-3D renderer: fullscreen-triangle raymarch over the nÂ³ field with an
// eased orbit camera (z-up voxel space). Mirrors the 2D Renderer's
// pipeline / rebind / uniform pattern; the camera replaces zoom/pan.

import { render3dWgsl, R3 } from "./shaders3d";
import type { Sim3D } from "./sim3d";

export interface CamState { az: number; el: number; dist: number; tgt: [number, number, number] }

export interface SliceSpec { axis: number; off: number; tilt: number; turn: number }
export interface SlicePlane { n: [number, number, number]; c: number }

/** slice spec (preset axis + depth + tilt/turn degrees) -> plane {unit nÌ‚, constant c} in voxels */
export function slicePlane(s: SliceSpec, n: number): SlicePlane {
  const a = [[1, 0, 0], [0, 1, 0], [0, 0, 1]][s.axis] as [number, number, number];
  const u = (s.axis === 0 ? [0, 1, 0] : [1, 0, 0]) as [number, number, number];
  const v = (s.axis === 2 ? [0, 1, 0] : [0, 0, 1]) as [number, number, number];
  const t = (s.tilt * Math.PI) / 180;
  const r = (s.turn * Math.PI) / 180;
  const nh: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 3; i++)
    nh[i] = Math.cos(t) * a[i] + Math.sin(t) * (Math.cos(r) * u[i] + Math.sin(r) * v[i]);
  const dMin = n * (Math.min(nh[0], 0) + Math.min(nh[1], 0) + Math.min(nh[2], 0));
  const dMax = n * (Math.max(nh[0], 0) + Math.max(nh[1], 0) + Math.max(nh[2], 0));
  return { n: nh, c: dMin + s.off * (dMax - dMin) };
}

const HOME = { az: -0.95, el: 0.42 };

// The replay's volume: 1 where a voxel is solid now AND froze strictly before
// S.x (age.r is the freeze time; the solver zeroes it on remelt), else 0. The
// raymarcher binds this in place of the state texture while scrubbing, so the
// hardware trilinear filter smooths the replayed surface like a live one.
const SCRUB3_WGSL = /* wgsl */ `
@group(0) @binding(0) var<uniform> S: vec4f;   // x = replay time, y = n
@group(0) @binding(1) var state: texture_3d<f32>;
@group(0) @binding(2) var age: texture_3d<f32>;
@group(0) @binding(3) var outPhi: texture_storage_3d<r32float, write>;
@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) g: vec3u) {
  let n = u32(S.y);
  if (g.x >= n || g.y >= n || g.z >= n) { return; }
  let c = vec3i(g);
  let wasSolid = textureLoad(state, c, 0).r >= 0.5 && textureLoad(age, c, 0).r < S.x;
  textureStore(outPhi, c, vec4f(select(0.0, 1.0, wasSolid), 0.0, 0.0, 0.0));
}`;

// One ray, one thread: march the pixel's ray through the field and report the
// grain id at the first solid voxel (0 when it reaches the far side), skipping
// the half a SLICE section removes. Nearest-voxel phi at half-voxel steps is
// finer than a grain, which is all a pick needs.
const PICK3_WGSL = /* wgsl */ `
struct PK { ro: vec4f, rd: vec4f, plane: vec4f, n: u32, usePlane: u32, _a: u32, _b: u32 }
@group(0) @binding(0) var<uniform> K: PK;
@group(0) @binding(1) var state: texture_3d<f32>;
@group(0) @binding(2) var grain: texture_3d<u32>;
@group(0) @binding(3) var<storage, read_write> outB: array<u32, 2>;
@compute @workgroup_size(1)
fn main() {
  let nf = f32(K.n);
  let ro = K.ro.xyz;
  let rd = K.rd.xyz;
  let inv = 1.0 / rd;
  let t0 = (vec3f(0.0) - ro) * inv;
  let t1 = (vec3f(nf) - ro) * inv;
  let tmin = min(t0, t1);
  let tmax = max(t0, t1);
  var t = max(max(tmin.x, tmin.y), max(tmin.z, 0.0)) + 0.01;
  let tEnd = min(min(tmax.x, tmax.y), tmax.z);
  outB[0] = 0u;
  outB[1] = 0u;
  loop {
    if (t >= tEnd) { break; }
    let p = ro + rd * t;
    let removed = K.usePlane == 1u && dot(p, K.plane.xyz) > K.plane.w;
    let c = clamp(vec3i(floor(p)), vec3i(0), vec3i(i32(K.n) - 1));
    if (!removed && textureLoad(state, c, 0).r >= 0.5) {
      outB[0] = textureLoad(grain, c, 0).r;
      outB[1] = bitcast<u32>(t);
      return;
    }
    t += 0.5;
  }
}`;

// Copies the photo accumulation to the canvas, pixel for pixel.
const BLIT_WGSL = /* wgsl */ `
@group(0) @binding(0) var src: texture_2d<f32>;
@vertex
fn vmain(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  let xy = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  return vec4f(xy * 2.0 - 1.0, 0.0, 1.0);
}
@fragment
fn fmain(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  return vec4f(textureLoad(src, vec2i(pos.xy), 0).rgb, 1.0);
}`;

export class Renderer3D {
  /** progressive samples per still view; past this the photo is final */
  static readonly PHOTO_SAMPLES = 48;

  private device: GPUDevice;
  private ctx: GPUCanvasContext;
  private canvas: HTMLCanvasElement;
  private pipe!: GPURenderPipeline;
  private rbuf!: GPUBuffer;
  private bg: GPUBindGroup[] = [];
  private rdata = new ArrayBuffer(R3.BYTES);
  private sampler: GPUSampler | null = null;
  private dummyTex!: GPUTexture;
  // photo mode: while the scene is still, jittered samples (soft shadows,
  // glossy reflections, sub-pixel offsets) average into a float target
  private photoPipe!: GPURenderPipeline;
  private blitPipe!: GPURenderPipeline;
  private bgPhoto: GPUBindGroup[] = [];
  private accum: GPUTexture | null = null;
  private blitBG: GPUBindGroup | null = null;
  private photoK = 0;
  private photoKey = "";
  // replay: the "solid then" volume, rebuilt when the time or the field moves
  private scrubPipe!: GPUComputePipeline;
  private scrubUbuf!: GPUBuffer;
  private scrubTex: GPUTexture | null = null;
  private scrubBG: GPUBindGroup[] = [];
  private scrubRenderBG: GPUBindGroup[] = [];
  private scrubPhotoBG: GPUBindGroup[] = [];
  private scrubKey = "";
  private lastSim: Sim3D | null = null;
  /** replay time (sim units): draw the solid as it stood then; null = live */
  scrubT: number | null = null;
  /** isolated grain id: only it renders opaque, the rest as glass (0 = off) */
  isoId = 0;
  private pickPipe!: GPUComputePipeline;
  private pickUbuf!: GPUBuffer;
  private pickOut!: GPUBuffer;
  private pickStage!: GPUBuffer;
  private pickBusy = false;
  // retro looks (flags bits 0/1) — the 2D renderer's pixel/palette identity
  voxelOn = false;
  paletteOn = false;
  /** studio lighting (look bit 0): AO, shadows, reflections, clearer melt */
  studioOn = true;
  readonly filterable: boolean;

  // orbit camera: targets + eased actuals
  private azT = HOME.az; private az = HOME.az;
  private elT = HOME.el; private el = HOME.el;
  private distT = 3; private dist = 3;
  private tgtT: [number, number, number] = [0, 0, 0];
  private tgt: [number, number, number] = [0, 0, 0];
  private n = 128;
  private tanHalfFov = Math.tan((38 * Math.PI / 180) / 2);

  constructor(device: GPUDevice, canvas: HTMLCanvasElement, sim3: Sim3D) {
    this.device = device;
    this.canvas = canvas;
    this.ctx = canvas.getContext("webgpu")!;
    const format = navigator.gpu.getPreferredCanvasFormat();
    this.ctx.configure({ device, format, alphaMode: "opaque" });

    this.filterable = device.features.has("float32-filterable");
    if (this.filterable)
      this.sampler = device.createSampler({ magFilter: "linear", minFilter: "linear" });

    const code = render3dWgsl(this.filterable);
    const module = device.createShaderModule({ code });
    this.pipe = device.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: "vmain" },
      fragment: { module, entryPoint: "fmain", targets: [{ format }] },
      primitive: { topology: "triangle-list" },
    });
    // sample k lands with weight 1/k: dst' = src/k + dst (1 - 1/k), a running mean
    this.photoPipe = device.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: "vmain" },
      fragment: {
        module, entryPoint: "fmain",
        targets: [{
          format: "rgba16float",
          blend: {
            color: { srcFactor: "constant", dstFactor: "one-minus-constant", operation: "add" },
            alpha: { srcFactor: "one", dstFactor: "zero", operation: "add" },
          },
        }],
      },
      primitive: { topology: "triangle-list" },
    });
    this.scrubPipe = device.createComputePipeline({
      layout: "auto",
      compute: { module: device.createShaderModule({ code: SCRUB3_WGSL }), entryPoint: "main" },
    });
    this.scrubUbuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.pickPipe = device.createComputePipeline({
      layout: "auto",
      compute: { module: device.createShaderModule({ code: PICK3_WGSL }), entryPoint: "main" },
    });
    this.pickUbuf = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.pickOut = device.createBuffer({ size: 8, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    this.pickStage = device.createBuffer({ size: 8, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const blit = device.createShaderModule({ code: BLIT_WGSL });
    this.blitPipe = device.createRenderPipeline({
      layout: "auto",
      vertex: { module: blit, entryPoint: "vmain" },
      fragment: { module: blit, entryPoint: "fmain", targets: [{ format }] },
      primitive: { topology: "triangle-list" },
    });
    this.rbuf = device.createBuffer({ size: R3.BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    // stand-in for the lazily-allocated solute texture (reads gated on flags bit 2)
    this.dummyTex = device.createTexture({
      size: [1, 1, 1], dimension: "3d", format: "r32float",
      usage: GPUTextureUsage.TEXTURE_BINDING,
    });
    this.rebind3(sim3);
  }

  rebind3(sim3: Sim3D) {
    this.rebindBGs(sim3);
    this.resetView();
  }

  /** the render pass's resources for ping-pong side `dir`, with `phiTex`
   *  standing in for the state texture (the replay's "solid then" volume) */
  private renderEntries(sim3: Sim3D, dir: number, phiTex?: GPUTexture): GPUBindGroupEntry[] {
    const entries: GPUBindGroupEntry[] = [
      { binding: 0, resource: { buffer: this.rbuf } },
      { binding: 1, resource: (phiTex ?? sim3.stateTexture(dir)).createView() },
      { binding: 2, resource: sim3.grainTexture(dir).createView() },
      { binding: 3, resource: { buffer: sim3.quatBuffer } },
      { binding: 5, resource: sim3.ageTexture.createView() },
      { binding: 6, resource: (sim3.soluteTexture(dir) ?? this.dummyTex).createView() },
      { binding: 7, resource: sim3.maskTexture.createView() },
    ];
    if (this.sampler) entries.push({ binding: 4, resource: this.sampler });
    return entries;
  }

  /**
   * Rebuild the replay volume when the replay time or the field changed.
   * Its own submit, ahead of the frame's render (queue order holds).
   */
  private ensureScrub(sim3: Sim3D, t: number) {
    const n = sim3.n;
    if (!this.scrubTex || this.scrubTex.width !== n || this.lastSim !== sim3) {
      this.scrubTex?.destroy();
      this.scrubTex = this.device.createTexture({
        size: [n, n, n], dimension: "3d", format: "r32float",
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
      });
      this.lastSim = sim3;
      this.scrubKey = "";
      for (const dir of [0, 1]) {
        this.scrubBG[dir] = this.device.createBindGroup({
          layout: this.scrubPipe.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: this.scrubUbuf } },
            { binding: 1, resource: sim3.stateTexture(dir).createView() },
            { binding: 2, resource: sim3.ageTexture.createView() },
            { binding: 3, resource: this.scrubTex.createView() },
          ],
        });
        const entries = this.renderEntries(sim3, dir, this.scrubTex);
        this.scrubRenderBG[dir] = this.device.createBindGroup({ layout: this.pipe.getBindGroupLayout(0), entries });
        this.scrubPhotoBG[dir] = this.device.createBindGroup({ layout: this.photoPipe.getBindGroupLayout(0), entries });
      }
    }
    const key = [t, sim3.frame, sim3.dir, sim3.simTime].join("|");
    if (key === this.scrubKey) return;
    this.scrubKey = key;
    this.device.queue.writeBuffer(this.scrubUbuf, 0, new Float32Array([t, n, 0, 0]));
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(this.scrubPipe);
    pass.setBindGroup(0, this.scrubBG[sim3.dir]);
    const g = Math.ceil(n / 4);
    pass.dispatchWorkgroups(g, g, g);
    pass.end();
    this.device.queue.submit([enc.finish()]);
  }

  /** free the replay volume (n^3 x 4 B) when replay ends */
  dropScrub() {
    this.scrubTex?.destroy();
    this.scrubTex = null;
    this.lastSim = null;
    this.scrubKey = "";
  }

  /** (re)build bind groups WITHOUT touching the camera — alloy toggles use this */
  rebindBGs(sim3: Sim3D) {
    this.n = sim3.n;
    this.dropScrub();   // its groups reference the old textures
    for (const dir of [0, 1]) {
      const entries = this.renderEntries(sim3, dir);
      this.bg[dir] = this.device.createBindGroup({
        layout: this.pipe.getBindGroupLayout(0),
        entries,
      });
      // "auto" layouts are per pipeline, so the photo pass needs its own groups
      this.bgPhoto[dir] = this.device.createBindGroup({
        layout: this.photoPipe.getBindGroupLayout(0),
        entries,
      });
    }
    this.photoKey = "";   // new textures: any accumulated photo is stale
  }

  resetView() {
    this.azT = HOME.az; this.elT = HOME.el;
    this.distT = 3.1;   // whole box in frame with a margin at 38Â° fov
    this.tgtT = [this.n / 2, this.n / 2, this.n / 2];
    // land instantly on first bind so the entry view doesn't swing in from nowhere
    this.az = this.azT; this.el = this.elT; this.dist = this.distT;
    this.tgt = [...this.tgtT];
  }

  /** current camera state (for the ViewCube mirror) */
  cam(): CamState { return { az: this.az, el: this.el, dist: this.dist, tgt: [...this.tgt] }; }

  orbitBy(dxPx: number, dyPx: number) {
    this.azT -= dxPx * 0.008;
    this.elT = Math.min(1.45, Math.max(-1.45, this.elT + dyPx * 0.008));
  }

  dollyBy(factor: number) {
    this.distT = Math.min(6, Math.max(1.15, this.distT * factor));
  }

  panTargetBy(dxPx: number, dyPx: number) {
    const b = this.basis();
    const scale = (this.dist * this.n * 0.55) / Math.max(this.canvas.clientHeight, 1) * 2 * this.tanHalfFov;
    const cl = (v: number) => Math.min(this.n, Math.max(0, v));
    this.tgtT = [
      cl(this.tgtT[0] - (b.right[0] * dxPx - b.up[0] * dyPx) * scale),
      cl(this.tgtT[1] - (b.right[1] * dxPx - b.up[1] * dyPx) * scale),
      cl(this.tgtT[2] - (b.right[2] * dxPx - b.up[2] * dyPx) * scale),
    ];
  }

  /** turntable: set the azimuth directly (no easing) for a constant-rate spin */
  spinTo(az: number) {
    this.az = az;
    this.azT = az;
  }

  /** project a voxel-space point to CSS client coords (null when behind the eye) */
  worldToClient(p: [number, number, number]): [number, number] | null {
    const b = this.basis();
    const v = [p[0] - b.eye[0], p[1] - b.eye[1], p[2] - b.eye[2]];
    const zf = v[0] * b.fwd[0] + v[1] * b.fwd[1] + v[2] * b.fwd[2];
    if (zf < 1e-3) return null;
    const xr = v[0] * b.right[0] + v[1] * b.right[1] + v[2] * b.right[2];
    const yu = v[0] * b.up[0] + v[1] * b.up[1] + v[2] * b.up[2];
    const rect = this.canvas.getBoundingClientRect();
    const aspect = rect.width / Math.max(rect.height, 1);
    const sx = xr / (zf * this.tanHalfFov * aspect);
    const sy = yu / (zf * this.tanHalfFov);
    return [rect.left + (sx * 0.5 + 0.5) * rect.width, rect.top + (0.5 - sy * 0.5) * rect.height];
  }

  /** CSS pixels per voxel at the camera-target distance — drives the 3D scale bar */
  cssPerVoxel(): number {
    const rect = this.canvas.getBoundingClientRect();
    return Math.max(rect.height, 1) / (2 * this.tanHalfFov * this.dist * this.n * 0.55);
  }

  /** ViewCube snap: ease the camera to a face / edge / corner direction */
  snapTo(dir: [number, number, number]) {
    const [x, y, z] = dir;
    const len = Math.hypot(x, y, z) || 1;
    const el = Math.asin(Math.min(1, Math.max(-1, z / len)));
    this.elT = Math.min(1.45, Math.max(-1.45, el));
    if (Math.abs(x) > 1e-6 || Math.abs(y) > 1e-6) {
      // pick the equivalent azimuth closest to the current one (no long way round)
      let az = Math.atan2(y, x);
      while (az - this.azT > Math.PI) az -= 2 * Math.PI;
      while (this.azT - az > Math.PI) az += 2 * Math.PI;
      this.azT = az;
    }
    this.tgtT = [this.n / 2, this.n / 2, this.n / 2];
  }

  /** ease actuals toward targets (no idle auto-orbit â€” the camera stays where you put it) */
  tick(dt: number) {
    const k = 1 - Math.exp(-dt * 10);
    this.az += (this.azT - this.az) * k;
    this.el += (this.elT - this.el) * k;
    this.dist += (this.distT - this.dist) * k;
    for (let i = 0; i < 3; i++) this.tgt[i] += (this.tgtT[i] - this.tgt[i]) * k;
  }

  /** camera basis in voxel space (z-up) */
  private basis() {
    const ce = Math.cos(this.el), se = Math.sin(this.el);
    const ca = Math.cos(this.az), sa = Math.sin(this.az);
    const off: [number, number, number] = [ce * ca, ce * sa, se];
    const d = this.dist * this.n * 0.55;
    const eye: [number, number, number] = [
      this.tgt[0] + off[0] * d, this.tgt[1] + off[1] * d, this.tgt[2] + off[2] * d];
    const fwd: [number, number, number] = [-off[0], -off[1], -off[2]];
    // right = normalize(fwd Ã— up0), up0 = +z
    const rx = fwd[1], ry = -fwd[0];
    const rl = Math.hypot(rx, ry) || 1;
    const right: [number, number, number] = [rx / rl, ry / rl, 0];
    const up: [number, number, number] = [
      right[1] * fwd[2] - right[2] * fwd[1],
      right[2] * fwd[0] - right[0] * fwd[2],
      right[0] * fwd[1] - right[1] * fwd[0],
    ];
    return { eye, fwd, right, up };
  }

  resize3() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = Math.floor(this.canvas.clientWidth * dpr);
    const h = Math.floor(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  /**
   * Quick-tap seeding: cast the pixel ray and intersect the slice plane when
   * given, else the view-facing plane through the volume centre. Returns
   * voxel coords clamped just inside the box, or null when the ray misses.
   */
  pickSeedPoint(clientX: number, clientY: number, plane: SlicePlane | null): [number, number, number] | null {
    const rect = this.canvas.getBoundingClientRect();
    const u = (clientX - rect.left) / Math.max(rect.width, 1);
    const v = (clientY - rect.top) / Math.max(rect.height, 1);
    const aspect = rect.width / Math.max(rect.height, 1);
    const b = this.basis();
    const sx = (u - 0.5) * 2 * this.tanHalfFov * aspect;
    const sy = (0.5 - v) * 2 * this.tanHalfFov;
    const rd: [number, number, number] = [
      b.fwd[0] + sx * b.right[0] + sy * b.up[0],
      b.fwd[1] + sx * b.right[1] + sy * b.up[1],
      b.fwd[2] + sx * b.right[2] + sy * b.up[2],
    ];
    const rl = Math.hypot(...rd);
    for (let i = 0; i < 3; i++) rd[i] /= rl;

    let t: number;
    if (plane) {
      const nrm = plane.n;
      const denom = rd[0] * nrm[0] + rd[1] * nrm[1] + rd[2] * nrm[2];
      if (Math.abs(denom) < 1e-6) return null;
      t = (plane.c - (b.eye[0] * nrm[0] + b.eye[1] * nrm[1] + b.eye[2] * nrm[2])) / denom;
    } else {
      const c = this.n / 2;
      const denom = rd[0] * b.fwd[0] + rd[1] * b.fwd[1] + rd[2] * b.fwd[2];
      if (Math.abs(denom) < 1e-6) return null;
      t = ((c - b.eye[0]) * b.fwd[0] + (c - b.eye[1]) * b.fwd[1] + (c - b.eye[2]) * b.fwd[2]) / denom;
    }
    if (t <= 0) return null;
    const p: [number, number, number] = [
      b.eye[0] + rd[0] * t, b.eye[1] + rd[1] * t, b.eye[2] + rd[2] * t];
    // reject taps that land well outside the volume; clamp near-misses inside
    const m = this.n * 0.25;
    for (const v2 of p) if (v2 < -m || v2 > this.n + m) return null;
    const cl = (x: number) => Math.min(this.n - 3, Math.max(2, x));
    return [cl(p[0]), cl(p[1]), cl(p[2])];
  }

  /**
   * Everything a still frame depends on. Any change restarts the photo
   * accumulation: camera (rounded, so easing that has converged counts as
   * still), lens, cut, look, canvas size, and the field itself through the
   * solver's frame counter, ping-pong side and clock.
   */
  private sceneKey(sim3: Sim3D, view3: number, plane: SlicePlane, cutStyle: number): string {
    const r = (v: number) => Math.round(v * 1e4);
    const p = sim3.params;
    return [
      r(this.az), r(this.el), r(this.dist), r(this.tgt[0]), r(this.tgt[1]), r(this.tgt[2]),
      view3, cutStyle, r(plane.n[0]), r(plane.n[1]), r(plane.n[2]), r(plane.c),
      sim3.n, sim3.dir, sim3.frame, sim3.simTime, sim3.alloyActive ? 1 : 0, p.scen,
      p.meltGlow, p.tFar, p.nyCrit, p.c0,
      this.canvas.width, this.canvas.height,
      this.voxelOn ? 1 : 0, this.paletteOn ? 1 : 0, this.studioOn ? 1 : 0, this.scrubT ?? -1, this.isoId,
    ].join(",");
  }

  /** samples accumulated in the current photo (0 while live) */
  get photoSamples(): number { return this.photoK; }

  private ensureAccum() {
    const w = this.canvas.width, h = this.canvas.height;
    if (this.accum && this.accum.width === w && this.accum.height === h) return;
    this.accum?.destroy();
    this.accum = this.device.createTexture({
      size: [w, h], format: "rgba16float",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.blitBG = this.device.createBindGroup({
      layout: this.blitPipe.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: this.accum.createView() }],
    });
    this.photoKey = "";
  }

  /**
   * The grain under a client point: the id at the first solid voxel along the
   * pixel's ray (the camera's own ray, so what you see is what you pick), or 0
   * for none. Resolves null when a pick is already in flight.
   */
  async pickGrain(sim3: Sim3D, clientX: number, clientY: number, plane: SlicePlane | null):
    Promise<{ id: number; depth: number } | null> {
    if (this.pickBusy) return null;
    this.pickBusy = true;
    try {
      const rect = this.canvas.getBoundingClientRect();
      const u = (clientX - rect.left) / Math.max(rect.width, 1);
      const v = (clientY - rect.top) / Math.max(rect.height, 1);
      const aspect = rect.width / Math.max(rect.height, 1);
      const b = this.basis();
      const sx = (u - 0.5) * 2 * this.tanHalfFov * aspect;
      const sy = (0.5 - v) * 2 * this.tanHalfFov;
      const rd = [0, 1, 2].map(i => b.fwd[i] + sx * b.right[i] + sy * b.up[i]);
      const rl = Math.hypot(rd[0], rd[1], rd[2]);
      const buf = new ArrayBuffer(64);
      const f = new Float32Array(buf), w = new Uint32Array(buf);
      f.set([b.eye[0], b.eye[1], b.eye[2], 0], 0);
      f.set([rd[0] / rl, rd[1] / rl, rd[2] / rl, 0], 4);
      if (plane) f.set([plane.n[0], plane.n[1], plane.n[2], plane.c], 8);
      w[12] = sim3.n;
      w[13] = plane ? 1 : 0;
      this.device.queue.writeBuffer(this.pickUbuf, 0, buf);
      const bg = this.device.createBindGroup({
        layout: this.pickPipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.pickUbuf } },
          { binding: 1, resource: sim3.stateTexture(sim3.dir).createView() },
          { binding: 2, resource: sim3.grainTexture(sim3.dir).createView() },
          { binding: 3, resource: { buffer: this.pickOut } },
        ],
      });
      const enc = this.device.createCommandEncoder();
      const pass = enc.beginComputePass();
      pass.setPipeline(this.pickPipe);
      pass.setBindGroup(0, bg);
      pass.dispatchWorkgroups(1);
      pass.end();
      enc.copyBufferToBuffer(this.pickOut, 0, this.pickStage, 0, 8);
      this.device.queue.submit([enc.finish()]);
      await this.pickStage.mapAsync(GPUMapMode.READ);
      const out = new Uint32Array(this.pickStage.getMappedRange().slice(0));
      this.pickStage.unmap();
      return { id: out[0], depth: new Float32Array(out.buffer)[1] };
    } catch {
      return null;
    } finally {
      this.pickBusy = false;
    }
  }

  /**
   * Draw one frame. `still` (the caller's promise that nothing is stepping,
   * staging seeds, annealing, recording or sweeping) enables photo mode:
   * up to PHOTO_SAMPLES jittered samples average into a float target, which
   * is copied to the canvas every frame. Callers that need one deterministic
   * live frame (exports, optimizer thumbnails) omit it.
   */
  render(sim3: Sim3D, view3: number, time: number, plane: SlicePlane, cutStyle = 0, still = false) {
    this.resize3();
    const scrubbing = this.scrubT != null;
    if (scrubbing) this.ensureScrub(sim3, this.scrubT!);
    else if (this.scrubTex) this.dropScrub();
    let k = 0;
    if (still) {
      this.ensureAccum();
      const key = this.sceneKey(sim3, view3, plane, cutStyle);
      if (key !== this.photoKey) { this.photoKey = key; this.photoK = 0; }
      if (this.photoK < Renderer3D.PHOTO_SAMPLES) k = ++this.photoK;
    } else {
      this.photoK = 0;
      this.photoKey = "";
    }
    const b = this.basis();
    const u = new Uint32Array(this.rdata);
    const f = new Float32Array(this.rdata);
    u[R3.view] = view3;
    u[R3.n] = sim3.n;
    f[R3.canvasW] = this.canvas.width;
    f[R3.canvasH] = this.canvas.height;
    f[R3.time] = time;
    f[R3.photo] = k;
    // look bit 1: replaying — the bound phi is the "solid then" volume and
    // temperature/solute (never stored) read at their far-field values
    f[R3.look] = (this.studioOn ? 1 : 0) | (scrubbing ? 2 : 0);
    const masked = sim3.params.scen === 3 || sim3.params.scen === 4;   // pigtail / mould shell
    u[R3.flags] = ((cutStyle & 15) << 4) | (sim3.alloyActive && !scrubbing ? 4 : 0) | (masked ? 8 : 0)
      | (this.voxelOn ? 1 : 0) | (this.paletteOn ? 2 : 0);
    f[R3.meltGlow] = sim3.params.meltGlow;
    f[R3.tFar] = sim3.params.tFar;
    f[R3.stepScale] = 0.7;
    u[R3.iso] = this.isoId;
    f[R3.sliceN] = plane.n[0]; f[R3.sliceN + 1] = plane.n[1];
    f[R3.sliceN + 2] = plane.n[2]; f[R3.sliceN + 3] = plane.c;
    // the Niyama ramp scale is the SAME threshold the stats risk counter uses
    // (one owner: sim3d.params.nyCrit, derived in main from the cited steel
    // criterion when units are known, the legacy 8.0 otherwise) — a render
    // thresholded differently from the census would be two verdicts
    // RINGS normalizes freeze time by the clock: the replay's clock is scrubT
    f[R3.misc] = scrubbing ? this.scrubT! : sim3.simTime; f[R3.misc + 1] = sim3.params.nyCrit;
    f[R3.misc + 2] = sim3.params.c0;   // far-field composition for the solute lenses
    f[R3.eye] = b.eye[0]; f[R3.eye + 1] = b.eye[1]; f[R3.eye + 2] = b.eye[2]; f[R3.eye + 3] = this.tanHalfFov;
    f[R3.right] = b.right[0]; f[R3.right + 1] = b.right[1]; f[R3.right + 2] = b.right[2];
    f[R3.right + 3] = this.canvas.width / Math.max(this.canvas.height, 1);
    f[R3.up] = b.up[0]; f[R3.up + 1] = b.up[1]; f[R3.up + 2] = b.up[2];
    f[R3.fwd] = b.fwd[0]; f[R3.fwd + 1] = b.fwd[1]; f[R3.fwd + 2] = b.fwd[2];
    this.device.queue.writeBuffer(this.rbuf, 0, this.rdata);

    const enc = this.device.createCommandEncoder();
    if (!still) {
      const pass = enc.beginRenderPass({
        colorAttachments: [{
          view: this.ctx.getCurrentTexture().createView(),
          loadOp: "clear",
          clearValue: { r: 0.04, g: 0.04, b: 0.05, a: 1 },
          storeOp: "store",
        }],
      });
      pass.setPipeline(this.pipe);
      pass.setBindGroup(0, scrubbing ? this.scrubRenderBG[sim3.dir] : this.bg[sim3.dir]);
      pass.draw(3);
      pass.end();
    } else {
      if (k > 0) {
        const acc = enc.beginRenderPass({
          colorAttachments: [{
            view: this.accum!.createView(),
            // the first sample replaces whatever an earlier view left behind
            loadOp: k === 1 ? "clear" : "load",
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            storeOp: "store",
          }],
        });
        acc.setPipeline(this.photoPipe);
        acc.setBindGroup(0, scrubbing ? this.scrubPhotoBG[sim3.dir] : this.bgPhoto[sim3.dir]);
        const w = 1 / k;
        acc.setBlendConstant({ r: w, g: w, b: w, a: w });
        acc.draw(3);
        acc.end();
      }
      const out = enc.beginRenderPass({
        colorAttachments: [{
          view: this.ctx.getCurrentTexture().createView(),
          loadOp: "clear",
          clearValue: { r: 0.04, g: 0.04, b: 0.05, a: 1 },
          storeOp: "store",
        }],
      });
      out.setPipeline(this.blitPipe);
      out.setBindGroup(0, this.blitBG!);
      out.draw(3);
      out.end();
    }
    this.device.queue.submit([enc.finish()]);
  }
}
