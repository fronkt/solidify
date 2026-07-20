// CAD-style ViewCube: a small Canvas2D cube that mirrors the 3D orbit camera.
// Click a face for an axis view, an edge or corner for the matching isometric;
// drag the cube itself to orbit. Faces are hit-tested by inverting the
// orthographic projection (exact 2x2 solve — the projected face is a
// parallelogram), then u/v thresholds decide face vs edge vs corner.

import type { CamState } from "./render3d";

type V3 = [number, number, number];

interface Face { n: V3; ta: V3; tb: V3; label: string }

const FACES: Face[] = [
  { n: [1, 0, 0], ta: [0, 1, 0], tb: [0, 0, 1], label: "RIGHT" },
  { n: [-1, 0, 0], ta: [0, -1, 0], tb: [0, 0, 1], label: "LEFT" },
  { n: [0, 1, 0], ta: [-1, 0, 0], tb: [0, 0, 1], label: "BACK" },
  { n: [0, -1, 0], ta: [1, 0, 0], tb: [0, 0, 1], label: "FRONT" },
  { n: [0, 0, 1], ta: [1, 0, 0], tb: [0, 1, 0], label: "TOP" },
  { n: [0, 0, -1], ta: [1, 0, 0], tb: [0, -1, 0], label: "BOT" },
];

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (a: V3, b: V3, s = 1): V3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];

export class ViewCube {
  private ctx: CanvasRenderingContext2D;
  private hover: string | null = null;
  private drag: { x: number; y: number; moved: boolean } | null = null;
  private lastCam: CamState | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private hooks: { snapTo(dir: V3): void; orbitBy(dx: number, dy: number): void },
  ) {
    this.ctx = canvas.getContext("2d")!;
    canvas.addEventListener("pointerdown", e => {
      this.drag = { x: e.clientX, y: e.clientY, moved: false };
      canvas.setPointerCapture(e.pointerId);
      e.stopPropagation();
    });
    canvas.addEventListener("pointermove", e => {
      if (this.drag) {
        const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
        if (this.drag.moved || Math.hypot(dx, dy) > 4) {
          this.drag.moved = true;
          // grabbing the cube spins the CUBE with the hand — the camera orbits
          // the opposite way horizontally (drag right = see the cube's right)
          this.hooks.orbitBy(-dx, dy);
          this.drag.x = e.clientX;
          this.drag.y = e.clientY;
        }
      } else {
        const dir = this.pick(e);
        this.hover = dir ? dir.join(",") : null;
        this.canvas.style.cursor = dir ? "pointer" : "default";
      }
    });
    canvas.addEventListener("pointerup", e => {
      if (this.drag && !this.drag.moved) {
        const dir = this.pick(e);
        if (dir) this.hooks.snapTo(dir);
      }
      this.drag = null;
    });
    canvas.addEventListener("pointerleave", () => { this.hover = null; });
  }

  /** camera basis (matches Renderer3D: z-up, eye offset by az/el) */
  private basis(cam: CamState) {
    const ce = Math.cos(cam.el), se = Math.sin(cam.el);
    const ca = Math.cos(cam.az), sa = Math.sin(cam.az);
    const off: V3 = [ce * ca, ce * sa, se];
    const fwd: V3 = [-off[0], -off[1], -off[2]];
    const rl = Math.hypot(fwd[1], -fwd[0]) || 1;
    const right: V3 = [fwd[1] / rl, -fwd[0] / rl, 0];
    const up: V3 = [
      right[1] * fwd[2] - right[2] * fwd[1],
      right[2] * fwd[0] - right[0] * fwd[2],
      right[0] * fwd[1] - right[1] * fwd[0],
    ];
    return { off, right, up };
  }

  private project(v: V3, b: { right: V3; up: V3 }, cx: number, cy: number, s: number): [number, number] {
    return [cx + dot(v, b.right) * s, cy - dot(v, b.up) * s];
  }

  /** pointer event -> snapped direction (face / edge / corner), or null */
  private pick(e: PointerEvent): V3 | null {
    if (!this.lastCam) return null;
    const rect = this.canvas.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * this.canvas.width;
    const py = ((e.clientY - rect.top) / rect.height) * this.canvas.height;
    const b = this.basis(this.lastCam);
    const cx = this.canvas.width / 2, cy = this.canvas.height / 2;
    const s = this.canvas.width * 0.27;

    for (const f of FACES) {
      if (dot(f.n, b.off) < 0.02) continue;
      // solve click = P(n) + u P(ta) + v P(tb) for (u, v)
      const p0 = this.project(f.n, b, cx, cy, s);
      const pa: [number, number] = [dot(f.ta, b.right) * s, -dot(f.ta, b.up) * s];
      const pb: [number, number] = [dot(f.tb, b.right) * s, -dot(f.tb, b.up) * s];
      const det = pa[0] * pb[1] - pa[1] * pb[0];
      if (Math.abs(det) < 1e-6) continue;
      const rx = px - p0[0], ry = py - p0[1];
      const u = (rx * pb[1] - ry * pb[0]) / det;
      const v = (ry * pa[0] - rx * pa[1]) / det;
      if (Math.abs(u) > 1.06 || Math.abs(v) > 1.06) continue;
      const cu = u > 0.55 ? 1 : u < -0.55 ? -1 : 0;
      const cv = v > 0.55 ? 1 : v < -0.55 ? -1 : 0;
      let dir: V3 = [...f.n];
      dir = add(dir, f.ta, cu);
      dir = add(dir, f.tb, cv);
      return dir;
    }
    return null;
  }

  /** redraw mirroring the camera; call once per 3D frame */
  draw(cam: CamState) {
    this.lastCam = cam;
    const ctx = this.ctx;
    const w = this.canvas.width, h = this.canvas.height;
    const cx = w / 2, cy = h / 2;
    const s = w * 0.27;
    const b = this.basis(cam);
    ctx.clearRect(0, 0, w, h);

    const light: V3 = [0.36, -0.5, 0.79];
    const visible = FACES.filter(f => dot(f.n, b.off) > 0.02)
      .sort((f1, f2) => dot(f1.n, b.off) - dot(f2.n, b.off));

    for (const f of visible) {
      const corners: V3[] = [
        add(add([...f.n] as V3, f.ta, -1), f.tb, -1),
        add(add([...f.n] as V3, f.ta, 1), f.tb, -1),
        add(add([...f.n] as V3, f.ta, 1), f.tb, 1),
        add(add([...f.n] as V3, f.ta, -1), f.tb, 1),
      ];
      const pts = corners.map(c => this.project(c, b, cx, cy, s));
      const lit = 0.5 + 0.5 * Math.max(0, dot(f.n, light));
      const hovered = this.hover != null && this.hover.split(",").map(Number).every((v, i) => v === f.n[i]);
      const base = 22 + lit * 26 + (hovered ? 16 : 0);
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < 4; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
      ctx.fillStyle = `rgb(${base + 2}, ${base + 4}, ${base + 9})`;
      ctx.fill();
      ctx.strokeStyle = hovered ? "rgba(255,180,84,0.9)" : "rgba(120,130,145,0.55)";
      ctx.lineWidth = hovered ? 1.6 : 1;
      ctx.stroke();

      const fc = this.project(f.n, b, cx, cy, s);
      ctx.fillStyle = hovered ? "#ffb454" : "rgba(200,206,215,0.85)";
      ctx.font = `600 ${Math.round(w * 0.10)}px ui-monospace, Consolas, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const fade = Math.min(1, Math.max(0, (dot(f.n, b.off) - 0.15) * 3));
      ctx.globalAlpha = fade;
      ctx.fillText(f.label, fc[0], fc[1]);
      ctx.globalAlpha = 1;
    }
  }
}
