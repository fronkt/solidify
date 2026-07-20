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

export class Renderer3D {
  private device: GPUDevice;
  private ctx: GPUCanvasContext;
  private canvas: HTMLCanvasElement;
  private pipe!: GPURenderPipeline;
  private rbuf!: GPUBuffer;
  private bg: GPUBindGroup[] = [];
  private rdata = new ArrayBuffer(R3.BYTES);
  private sampler: GPUSampler | null = null;
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
    this.pipe = device.createRenderPipeline({
      layout: "auto",
      vertex: { module: device.createShaderModule({ code }), entryPoint: "vmain" },
      fragment: {
        module: device.createShaderModule({ code }),
        entryPoint: "fmain",
        targets: [{ format }],
      },
      primitive: { topology: "triangle-list" },
    });
    this.rbuf = device.createBuffer({ size: R3.BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.rebind3(sim3);
  }

  rebind3(sim3: Sim3D) {
    this.n = sim3.n;
    for (const dir of [0, 1]) {
      const entries: GPUBindGroupEntry[] = [
        { binding: 0, resource: { buffer: this.rbuf } },
        { binding: 1, resource: sim3.stateTexture(dir).createView() },
        { binding: 2, resource: sim3.grainTexture(dir).createView() },
        { binding: 3, resource: { buffer: sim3.quatBuffer } },
        { binding: 5, resource: sim3.ageTexture.createView() },
      ];
      if (this.sampler) entries.push({ binding: 4, resource: this.sampler });
      this.bg[dir] = this.device.createBindGroup({
        layout: this.pipe.getBindGroupLayout(0),
        entries,
      });
    }
    this.resetView();
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
    this.azT += dxPx * 0.008;
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

  render(sim3: Sim3D, view3: number, time: number, plane: SlicePlane, cutStyle = 0) {
    this.resize3();
    const b = this.basis();
    const u = new Uint32Array(this.rdata);
    const f = new Float32Array(this.rdata);
    u[R3.view] = view3;
    u[R3.n] = sim3.n;
    f[R3.canvasW] = this.canvas.width;
    f[R3.canvasH] = this.canvas.height;
    f[R3.time] = time;
    u[R3.flags] = (cutStyle & 15) << 4;
    f[R3.meltGlow] = sim3.params.meltGlow;
    f[R3.tFar] = sim3.params.tFar;
    f[R3.stepScale] = 0.7;
    f[R3.sliceN] = plane.n[0]; f[R3.sliceN + 1] = plane.n[1];
    f[R3.sliceN + 2] = plane.n[2]; f[R3.sliceN + 3] = plane.c;
    f[R3.misc] = sim3.simTime; f[R3.misc + 1] = 8.0;
    f[R3.eye] = b.eye[0]; f[R3.eye + 1] = b.eye[1]; f[R3.eye + 2] = b.eye[2]; f[R3.eye + 3] = this.tanHalfFov;
    f[R3.right] = b.right[0]; f[R3.right + 1] = b.right[1]; f[R3.right + 2] = b.right[2];
    f[R3.right + 3] = this.canvas.width / Math.max(this.canvas.height, 1);
    f[R3.up] = b.up[0]; f[R3.up + 1] = b.up[1]; f[R3.up + 2] = b.up[2];
    f[R3.fwd] = b.fwd[0]; f[R3.fwd + 1] = b.fwd[1]; f[R3.fwd + 2] = b.fwd[2];
    this.device.queue.writeBuffer(this.rbuf, 0, this.rdata);

    const enc = this.device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{
        view: this.ctx.getCurrentTexture().createView(),
        loadOp: "clear",
        clearValue: { r: 0.04, g: 0.04, b: 0.05, a: 1 },
        storeOp: "store",
      }],
    });
    pass.setPipeline(this.pipe);
    pass.setBindGroup(0, this.bg[sim3.dir]);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([enc.finish()]);
  }
}
