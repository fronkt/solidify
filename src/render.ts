import { RENDER_WGSL } from "./shaders";
import type { Simulation } from "./sim";

export type ViewMode = 0 | 1 | 2 | 3; // melt, orientation, micrograph, field

export class Renderer {
  private device: GPUDevice;
  private ctx: GPUCanvasContext;
  private canvas: HTMLCanvasElement;
  private pipe!: GPURenderPipeline;
  private rbuf!: GPUBuffer;
  private bg: GPUBindGroup[] = [];
  private rdata = new ArrayBuffer(32);

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
    this.rbuf = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.rebind(sim);
  }

  /** (re)create bind groups for the sim's ping-pong textures */
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

  /** map a client-space point to grid cells (cover fit), or null if outside */
  clientToGrid(cx: number, cy: number, n: number): { x: number; y: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = this.canvas.width / rect.width;
    const px = (cx - rect.left) * dpr;
    const py = (cy - rect.top) * dpr;
    const scale = Math.max(this.canvas.width, this.canvas.height);
    const offX = (this.canvas.width - scale) * 0.5;
    const offY = (this.canvas.height - scale) * 0.5;
    const gx = ((px - offX) / scale) * n;
    const gy = ((py - offY) / scale) * n;
    if (gx < 0 || gy < 0 || gx >= n || gy >= n) return null;
    return { x: gx, y: gy };
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
