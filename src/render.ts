import { RENDER_WGSL } from "./shaders";
import type { Simulation } from "./sim";

export type ViewMode = number; // lens index 0..9

export class Renderer {
  private device: GPUDevice;
  private ctx: GPUCanvasContext;
  private canvas: HTMLCanvasElement;
  private pipe!: GPURenderPipeline;
  private rbuf!: GPUBuffer;
  private bg: GPUBindGroup[] = [];
  private rdata = new ArrayBuffer(64);

  // view transform (zoom/pan) + retro toggles
  zoom = 1;
  cx = 0.5;
  cy = 0.5;
  pixelSize = 0;   // 0 = off, else cells per chunky pixel
  paletteOn = false;
  stainMode = 0;   // ETCH tint etch: 0 none, 1 Klemm's, 2 Beraha's, 3 anodize
  ebsdOn = false;  // ORIENT as flat EBSD/IPF map

  constructor(device: GPUDevice, canvas: HTMLCanvasElement, sim: Simulation) {
    this.device = device;
    this.canvas = canvas;
    this.ctx = canvas.getContext("webgpu")!;
    const format = navigator.gpu.getPreferredCanvasFormat();
    this.ctx.configure({ device, format, alphaMode: "opaque" });

    this.pipe = device.createRenderPipeline({
      layout: "auto",
      vertex: { module: device.createShaderModule({ code: RENDER_WGSL }), entryPoint: "vmain" },
      fragment: {
        module: device.createShaderModule({ code: RENDER_WGSL }),
        entryPoint: "fmain",
        targets: [{ format }],
      },
      primitive: { topology: "triangle-list" },
    });
    this.rbuf = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.rebind(sim);
  }

  rebind(sim: Simulation) {
    for (const dir of [0, 1]) {
      this.bg[dir] = this.device.createBindGroup({
        layout: this.pipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.rbuf } },
          { binding: 1, resource: sim.stateTexture(dir).createView() },
          { binding: 2, resource: sim.grainTexture(dir).createView() },
          { binding: 3, resource: { buffer: sim.theta0Buffer } },
        ],
      });
    }
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(this.canvas.clientWidth * dpr);
    const h = Math.floor(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  /** clamp pan so the visible window stays inside the domain */
  clampView() {
    this.zoom = Math.min(24, Math.max(1, this.zoom));
    const half = 0.5 / this.zoom;
    this.cx = Math.min(1 - half, Math.max(half, this.cx));
    this.cy = Math.min(1 - half, Math.max(half, this.cy));
  }

  resetView() { this.zoom = 1; this.cx = 0.5; this.cy = 0.5; }

  /** client point -> cover-space 0..1 (before zoom) */
  private clientToCover(cxp: number, cyp: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = this.canvas.width / rect.width;
    const px = (cxp - rect.left) * dpr;
    const py = (cyp - rect.top) * dpr;
    const scale = Math.max(this.canvas.width, this.canvas.height);
    const offX = (this.canvas.width - scale) * 0.5;
    const offY = (this.canvas.height - scale) * 0.5;
    return { x: (px - offX) / scale, y: (py - offY) / scale };
  }

  /** map a client-space point to grid cells (through zoom/pan), or null if outside */
  clientToGrid(cxp: number, cyp: number, n: number): { x: number; y: number } | null {
    const c = this.clientToCover(cxp, cyp);
    const gx = ((c.x - 0.5) / this.zoom + this.cx) * n;
    const gy = ((c.y - 0.5) / this.zoom + this.cy) * n;
    if (gx < 0 || gy < 0 || gx >= n || gy >= n) return null;
    return { x: gx, y: gy };
  }

  /** zoom about a client-space anchor point */
  zoomAt(cxp: number, cyp: number, factor: number) {
    const c = this.clientToCover(cxp, cyp);
    const beforeX = (c.x - 0.5) / this.zoom + this.cx;
    const beforeY = (c.y - 0.5) / this.zoom + this.cy;
    this.zoom *= factor;
    this.zoom = Math.min(24, Math.max(1, this.zoom));
    this.cx = beforeX - (c.x - 0.5) / this.zoom;
    this.cy = beforeY - (c.y - 0.5) / this.zoom;
    this.clampView();
  }

  /** pan by a client-space pixel delta */
  panBy(dxPx: number, dyPx: number) {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = this.canvas.width / rect.width;
    const scale = Math.max(this.canvas.width, this.canvas.height);
    this.cx -= (dxPx * dpr) / scale / this.zoom;
    this.cy -= (dyPx * dpr) / scale / this.zoom;
    this.clampView();
  }

  /** grid cell -> client-space css point (inverse of clientToGrid), for DOM overlays */
  gridToClient(gx: number, gy: number, n: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = this.canvas.width / Math.max(rect.width, 1);
    const scale = Math.max(this.canvas.width, this.canvas.height);
    const offX = (this.canvas.width - scale) * 0.5;
    const offY = (this.canvas.height - scale) * 0.5;
    const cx = (gx / n - this.cx) * this.zoom + 0.5;
    const cy = (gy / n - this.cy) * this.zoom + 0.5;
    return { x: (cx * scale + offX) / dpr + rect.left, y: (cy * scale + offY) / dpr + rect.top };
  }

  /** css px per grid cell at current zoom (for the scale bar) */
  cssPxPerCell(n: number): number {
    const rect = this.canvas.getBoundingClientRect();
    const scaleCss = Math.max(rect.width, rect.height);
    return (scaleCss / n) * this.zoom;
  }

  render(sim: Simulation, view: ViewMode, time: number) {
    this.resize();
    const u = new Uint32Array(this.rdata);
    const f = new Float32Array(this.rdata);
    u[0] = view;
    u[1] = sim.n;
    f[2] = this.canvas.width;
    f[3] = this.canvas.height;
    f[4] = time;
    f[5] = sim.params.aniMode;
    f[6] = sim.params.tFar;
    f[7] = this.zoom;
    f[8] = this.cx;
    f[9] = this.cy;
    f[10] = this.pixelSize;
    u[11] = this.paletteOn ? 1 : 0;
    u[12] = sim.params.alloyOn;
    f[13] = sim.params.c0;
    f[14] = sim.params.meltGlow;
    u[15] = (this.stainMode & 255) | (this.ebsdOn ? 256 : 0);
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
    pass.setBindGroup(0, this.bg[sim.dir]);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([enc.finish()]);
  }
}
