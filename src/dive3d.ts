// THE DIVE, in true 3D. The same descent — GPU card → die → electron column →
// specimen → dendrite — but every stage is a live Three.js wireframe scene the
// way exealabs.org actually builds theirs: LineSegments geometry from a
// procedural builder, a scroll-keyframed camera that orbits while it dollies,
// idle sway + pointer parallax so nothing ever sits still, DOM labels and the
// amber reticle projected from world space every frame, and particles for
// life (heat wisps, HBM clock pulses, beam electrons). Stage 3 explodes the
// SEM column apart anime.js-lens style. Stage 5 grows a geometric dendrite
// under the scroll (drawRange over birth-sorted segments from dendrite.mjs).
// The old 2.5D SVG dive (dive.ts) stays as the no-WebGL / reduced-motion path.

import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Fog,
  BufferGeometry, Float32BufferAttribute, LineSegments, LineBasicMaterial,
  Points, PointsMaterial, Vector3,
} from "three";
import { Delaunay } from "d3-delaunay";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { genDendrite } from "./dendrite.mjs";

gsap.registerPlugin(ScrollTrigger);

// ---------------------------------------------------------------- palette
type Cls = "w" | "d" | "amber" | "beam";
const CLS_STYLE: Record<Cls, { color: number; base: number }> = {
  w: { color: 0xcfd6df, base: 0.9 },
  d: { color: 0x4d5665, base: 0.55 },
  amber: { color: 0xf59e0b, base: 0.95 },
  beam: { color: 0x56d4dd, base: 0.85 },
};

interface Mat { m: LineBasicMaterial; base: number; tag: string }

const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0), s / 4294967296);
}

// ------------------------------------------------------------ wire builder
type P3 = readonly [number, number, number];

class Wire {
  v: Record<Cls, number[]> = { w: [], d: [], amber: [], beam: [] };
  seg(a: P3, b: P3, cls: Cls = "w") {
    this.v[cls].push(a[0], a[1], a[2], b[0], b[1], b[2]);
  }
  poly(pts: P3[], cls: Cls = "w", close = true) {
    for (let i = 0; i < pts.length - 1; i++) this.seg(pts[i], pts[i + 1], cls);
    if (close && pts.length > 2) this.seg(pts[pts.length - 1], pts[0], cls);
  }
  circle(cx: number, cy: number, cz: number, r: number, plane: "xz" | "xy" | "yz", cls: Cls = "w", segs = 36, a0 = 0, a1 = Math.PI * 2) {
    const pts: P3[] = [];
    for (let i = 0; i <= segs; i++) {
      const a = a0 + ((a1 - a0) * i) / segs;
      const u = Math.cos(a) * r, w = Math.sin(a) * r;
      pts.push(plane === "xz" ? [cx + u, cy, cz + w] : plane === "xy" ? [cx + u, cy + w, cz] : [cx, cy + w, cz + u]);
    }
    this.poly(pts, cls, false);
  }
  box(x: number, y: number, z: number, w: number, h: number, d: number, cls: Cls = "w", verticals = true) {
    const b: P3[] = [[x, y, z], [x + w, y, z], [x + w, y, z + d], [x, y, z + d]];
    const t: P3[] = b.map(([a, , c]) => [a, y + h, c] as const);
    this.poly(t, cls);
    this.poly(b, cls);
    if (verticals) for (let i = 0; i < 4; i++) this.seg(b[i], t[i], cls);
  }
  /** vertical cylinder: two rings + n seam lines */
  cyl(cx: number, cy: number, cz: number, r: number, h: number, cls: Cls = "w", seams = 6, segs = 36) {
    this.circle(cx, cy, cz, r, "xz", cls, segs);
    this.circle(cx, cy + h, cz, r, "xz", cls, segs);
    for (let i = 0; i < seams; i++) {
      const a = (i / seams) * Math.PI * 2;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      this.seg([x, cy, z], [x, cy + h, z], cls);
    }
  }
  /** materialize into a group; one LineSegments per class with content */
  build(reg: Mat[], tag = ""): { group: Group; lines: Partial<Record<Cls, LineSegments>> } {
    const group = new Group();
    const lines: Partial<Record<Cls, LineSegments>> = {};
    (Object.keys(this.v) as Cls[]).forEach(cls => {
      if (!this.v[cls].length) return;
      const g = new BufferGeometry();
      g.setAttribute("position", new Float32BufferAttribute(this.v[cls], 3));
      const st = CLS_STYLE[cls];
      const m = new LineBasicMaterial({ color: st.color, transparent: true, opacity: st.base, depthWrite: false });
      reg.push({ m, base: st.base, tag });
      const ls = new LineSegments(g, m);
      lines[cls] = ls;
      group.add(ls);
    });
    return { group, lines };
  }
}

function upperBound(arr: number[], x: number) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] <= x) lo = m + 1; else hi = m; }
  return lo;
}

// -------------------------------------------------------------- HUD copy
interface StageMeta { field: string; title: string; sub: string }
const META: StageMeta[] = [
  { field: "FIELD ≈ 300 MM", title: "YOUR GPU", sub: "The furnace. A million cells solve the freeze on this card, sixty times a second." },
  { field: "FIELD ≈ 40 MM", title: "THE DIE", sub: "The field lives in VRAM: φ, T, c, age. 128 bits per cell, two compute passes per step." },
  { field: "FIELD ≈ 5 MM", title: "THE MICROSCOPE", sub: "An electron column, taken apart. Gun, condensers, scan coils, objective: the optics that see metal at the micron." },
  { field: "FIELD ≈ 500 µM", title: "THE SPECIMEN", sub: "Grains, boundaries, dendrite arms: the structure that decides whether metal holds." },
  { field: "FIELD ≈ 50 µM", title: "THE DENDRITE", sub: "Anisotropy chooses the arms. Latent heat spaces them. The lab grows the real thing live in your browser." },
];

// scroll weight per stage (stage 3 explodes, stage 5 grows: both earn dwell)
const WEIGHTS = [1.15, 1.15, 1.7, 1, 1.35];

// ------------------------------------------------------------- label defs
interface LabelDef {
  text: string;
  anchor: P3 | (() => Vector3);
  amber?: boolean;
  side: 1 | -1;          // 1 = text extends right of anchor
  alpha?: (f: number) => number;
}

interface StageDef {
  group: Group;
  mats: Mat[];
  labels: { def: LabelDef; el: HTMLElement }[];
  kfs?: { p: number; pos: P3; look: P3 }[];
  cam?: (f: number, pos: Vector3, look: Vector3) => void;
  update?: (f: number, t: number, dt: number) => void;
  target?: P3;           // reticle anchor, stage-local
  reticleLbl?: string;
  reticleFrom?: number;  // f at which the reticle appears
}

const defaultAlpha = (f: number) => smooth((f - 0.05) / 0.08) * (1 - smooth((f - 0.78) / 0.1));

// ------------------------------------------------------------------ init
export function initDive3D(): boolean {
  const act = document.getElementById("diveAct");
  const canvas = document.getElementById("dive3d") as HTMLCanvasElement | null;
  const labelBox = document.getElementById("diveLabels");
  const reticleEl = document.getElementById("diveReticle");
  if (!act || !canvas || !labelBox || !reticleEl) return false;

  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  } catch {
    return false;
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.setSize(innerWidth, innerHeight, false);

  act.classList.add("live3d");

  const scene = new Scene();
  scene.fog = new Fog(0x0b0d10, 15, 34);
  const camera = new PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 80);

  // faint star-dust shell: constant parallax depth reference across stages
  {
    const R = rng(77);
    const pos: number[] = [];
    for (let i = 0; i < 150; i++) {
      const r = 17 + R() * 14, th = R() * Math.PI * 2, ph = Math.acos(2 * R() - 1);
      pos.push(r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) * 0.7, r * Math.sin(ph) * Math.sin(th));
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(pos, 3));
    scene.add(new Points(g, new PointsMaterial({ color: 0x39414e, size: 0.12, transparent: true, opacity: 0.55, depthWrite: false })));
  }

  const stages: StageDef[] = [
    buildCard(), buildPackage(), buildColumn(), buildSpecimen(), buildDendriteStage(),
  ];
  for (const s of stages) { s.group.visible = false; scene.add(s.group); }

  // DOM labels
  for (const s of stages) {
    for (const L of s.labels) {
      const el = document.createElement("div");
      el.className = "dlab" + (L.def.amber ? " amber" : "") + (L.def.side === -1 ? " l" : "");
      el.textContent = L.def.text;
      labelBox.appendChild(el);
      L.el = el;
    }
  }
  const reticleLblEl = reticleEl.querySelector("span")!;
  const cta = document.getElementById("diveCta");

  // ------------------------------------------------------------------ HUD
  const fieldEl = document.getElementById("diveField")!;
  const numEl = document.getElementById("diveNum")!;
  const titleEl = document.getElementById("diveTitle")!;
  const subEl = document.getElementById("diveSub")!;
  const dashEls = [...document.querySelectorAll<HTMLElement>("#diveDashes i")];
  let curHud = -1;
  const setHud = (i: number) => {
    if (i === curHud) return;
    curHud = i;
    const m = META[i];
    fieldEl.textContent = m.field;
    numEl.textContent = `0${i + 1} / 05`;
    titleEl.textContent = m.title;
    subEl.textContent = m.sub;
    dashEls.forEach((d, j) => d.classList.toggle("on", j <= i));
    gsap.fromTo([titleEl, subEl], { y: 10, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, stagger: 0.05, ease: "power2.out", overwrite: true });
  };

  // ------------------------------------------------------- progress mapping
  const totalW = WEIGHTS.reduce((a, b) => a + b, 0);
  let progress = 0;
  const stageAt = (p: number): [number, number] => {
    let x = p * totalW;
    let i = 0;
    while (i < WEIGHTS.length - 1 && x > WEIGHTS[i]) { x -= WEIGHTS[i]; i++; }
    return [i, Math.min(1, x / WEIGHTS[i])];
  };

  // scroll velocity → fan boost
  let vel = 0, lastP = 0;

  // pointer parallax + idle sway
  const par = { x: 0, y: 0, tx: 0, ty: 0 };
  addEventListener("pointermove", e => {
    par.tx = (e.clientX / innerWidth - 0.5) * 2;
    par.ty = (e.clientY / innerHeight - 0.5) * 2;
  }, { passive: true });

  // visibility gating
  let onScreen = false;
  new IntersectionObserver(es => { for (const e of es) onScreen = e.isIntersecting; }, { threshold: 0 }).observe(act);

  const camPos = new Vector3(), camLook = new Vector3(), tmp = new Vector3();

  const camFromKfs = (kfs: NonNullable<StageDef["kfs"]>, f: number, pos: Vector3, look: Vector3) => {
    let i = 0;
    while (i < kfs.length - 2 && f > kfs[i + 1].p) i++;
    const a = kfs[i], b = kfs[i + 1];
    const u = smooth((f - a.p) / Math.max(1e-6, b.p - a.p));
    pos.set(lerp(a.pos[0], b.pos[0], u), lerp(a.pos[1], b.pos[1], u), lerp(a.pos[2], b.pos[2], u));
    look.set(lerp(a.look[0], b.look[0], u), lerp(a.look[1], b.look[1], u), lerp(a.look[2], b.look[2], u));
  };

  const project = (world: Vector3): { x: number; y: number; behind: boolean } => {
    tmp.copy(world).project(camera);
    return { x: (tmp.x * 0.5 + 0.5) * innerWidth, y: (-tmp.y * 0.5 + 0.5) * innerHeight, behind: tmp.z > 1 };
  };

  let lastT = performance.now();
  const frame = (now: number) => {
    requestAnimationFrame(frame);
    if (!onScreen || document.hidden) { lastT = now; return; }
    const dt = Math.min(0.1, (now - lastT) / 1000);
    lastT = now;
    const t = now / 1000;

    const [i, f] = stageAt(progress);
    const st = stages[i];
    stages.forEach((s, j) => { s.group.visible = j === i; });

    // dissolve envelope: tight, so no stage hides inside the cut — a fast
    // flick still travels THROUGH every stage thanks to scrub smoothing
    const isLast = i === stages.length - 1;
    const aIn = i === 0 ? 1 : smooth(f / 0.06);
    const aOut = isLast ? 1 : 1 - smooth((f - 0.93) / 0.07);
    const a = aIn * aOut;
    for (const m of st.mats) m.m.opacity = m.base * a * (st.group.userData.fade?.[m.tag] ?? 1);

    vel = lerp(vel, Math.abs(progress - lastP) / Math.max(dt, 1e-3), Math.min(1, dt * 6));
    lastP = progress;
    st.group.userData.vel = vel;
    st.update?.(f, t, dt);

    // camera: stage path + idle sway + pointer parallax (yaw around the look point)
    if (st.cam) st.cam(f, camPos, camLook);
    else camFromKfs(st.kfs!, f, camPos, camLook);
    const yaw = 0.05 * Math.sin(t * 0.22) + par.x * 0.07;
    par.x = lerp(par.x, par.tx, Math.min(1, dt * 2.5));
    par.y = lerp(par.y, par.ty, Math.min(1, dt * 2.5));
    tmp.copy(camPos).sub(camLook);
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const nx = tmp.x * cy - tmp.z * sy, nz = tmp.x * sy + tmp.z * cy;
    camPos.set(camLook.x + nx, camLook.y + tmp.y + (0.02 * Math.sin(t * 0.17) - par.y * 0.06) * tmp.length(), camLook.z + nz);
    camera.position.copy(camPos);
    camera.lookAt(camLook);
    scene.updateMatrixWorld();

    // labels: project anchors, apply per-label alpha windows
    for (const s of stages) {
      const active = s === st;
      for (const L of s.labels) {
        if (!active) { L.el.style.opacity = "0"; continue; }
        const alpha = (L.def.alpha ?? defaultAlpha)(f) * a;
        if (alpha <= 0.01) { L.el.style.opacity = "0"; continue; }
        const wv = typeof L.def.anchor === "function"
          ? L.def.anchor()
          : st.group.localToWorld(new Vector3(...(L.def.anchor as [number, number, number])));
        const pr = project(wv);
        if (pr.behind) { L.el.style.opacity = "0"; continue; }
        L.el.style.opacity = String(alpha);
        L.el.style.transform = `translate(${pr.x.toFixed(1)}px, ${pr.y.toFixed(1)}px)`;
      }
    }

    // reticle: bracket the dive target, swelling as the camera closes
    if (st.target && st.reticleFrom !== undefined && f >= st.reticleFrom && !isLast) {
      const rf = (f - st.reticleFrom) / (1 - st.reticleFrom);
      const w = st.group.localToWorld(new Vector3(...st.target));
      const pr = project(w);
      const grow = 1 + smooth(rf) * 1.6 + smooth((f - 0.94) / 0.06) * 2.2;
      const rw = 150 * grow, rh = 100 * grow;
      const op = smooth(rf / 0.25) * (1 - smooth((f - 0.965) / 0.035));
      reticleEl.style.display = "block";
      reticleEl.style.opacity = String(op);
      reticleEl.style.left = `${(pr.x - rw / 2).toFixed(1)}px`;
      reticleEl.style.top = `${(pr.y - rh / 2).toFixed(1)}px`;
      reticleEl.style.width = `${rw.toFixed(1)}px`;
      reticleEl.style.height = `${rh.toFixed(1)}px`;
      reticleLblEl.textContent = st.reticleLbl ?? "";
    } else {
      reticleEl.style.display = "none";
    }

    cta?.classList.toggle("on", isLast && f > 0.85);
    setHud(f > 0.95 && !isLast ? i + 1 : i);
    renderer.render(scene, camera);
  };

  ScrollTrigger.create({
    id: "dive",
    trigger: act,
    start: "top top",
    end: "+=8200",
    pin: true,
    scrub: 1,   // smoothed: momentum flicks glide through stages, never skip them
    refreshPriority: 1,   // first in the document: must refresh before the sim acts
    onUpdate: self => { progress = self.progress; },
  });
  ScrollTrigger.sort();
  ScrollTrigger.refresh();

  addEventListener("resize", () => {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  }, { passive: true });

  setHud(0);
  requestAnimationFrame(frame);
  return true;
}

// ==================================================================== S1
// GPU card, ported from scripts/gen-dive-art.mjs (mm coordinates, group
// scaled 0.03) — but now the fans actually spin.
function buildCard(): StageDef {
  const mats: Mat[] = [];
  const W = 267, DEP = 112, PCB = 3;
  const wire = new Wire();

  // ---- pcb slab, corner screws
  wire.box(0, 0, 0, W, PCB, DEP, "w");
  for (const [sx, sz] of [[7, 8], [W - 7, 8], [7, DEP - 8], [W - 7, DEP - 8]] as const)
    wire.circle(sx, PCB + 0.1, sz, 2.2, "xz", "d", 12);

  // ---- backplate: rim, X-brace, flow-through tail cutout with fins showing
  wire.box(3, -1.6, 3, W - 6, 1.6, DEP - 6, "d", false);
  wire.seg([10, -1.7, 10], [150, -1.7, DEP - 10], "d");
  wire.seg([10, -1.7, DEP - 10], [150, -1.7, 10], "d");
  wire.poly([[214, -1.7, 16], [258, -1.7, 16], [258, -1.7, 96], [214, -1.7, 96]], "d");
  for (let x = 218; x < 256; x += 6) wire.seg([x, -1.7, 20], [x, -1.7, 92], "d");

  // ---- shroud: body, chamfered top plate, louvers, accent spears
  const SH = { w: 176, h: 38 };
  const TY = PCB + SH.h;
  wire.box(0, PCB, 0, SH.w, SH.h, DEP, "w");
  wire.poly([[5, TY, 5], [SH.w - 5, TY, 5], [SH.w - 5, TY, DEP - 5], [5, TY, DEP - 5]], "d");
  for (let k = 0; k < 6; k++)
    wire.seg([148 + k * 4.5, PCB + 6, DEP + 0.1], [153 + k * 4.5, PCB + SH.h - 8, DEP + 0.1], "d");
  wire.seg([6, PCB + 8, DEP + 0.1], [120, PCB + 8, DEP + 0.1], "d");
  wire.seg([6, PCB + SH.h - 4, DEP + 0.1], [140, PCB + SH.h - 4, DEP + 0.1], "d");

  // ---- fin stack on BOTH long edges
  for (let x = 8; x < SH.w - 6; x += 5) {
    wire.seg([x, PCB + 2, DEP + 0.1], [x, PCB + SH.h - 6, DEP + 0.1], "d");
    wire.seg([x, PCB + 2, -0.1], [x, PCB + SH.h - 6, -0.1], "d");
  }

  // ---- heatpipes sweeping from the vapor chamber over the die into the fins
  for (let k = 0; k < 4; k++) {
    const z0 = 30 + k * 14;
    wire.poly([
      [206, PCB + 3.5, z0], [176, PCB + 6 + k, z0],
      [150, PCB + 9 + k, 16 + k * 24], [24, PCB + 9 + k, 16 + k * 24],
    ], k % 2 ? "d" : "w", false);
  }

  // ---- exposed pcb: package substrate, die, retention screws, GDDR ring, VRM
  wire.box(188, PCB, 26, 50, 1.2, 50, "d", false);
  wire.box(196, PCB + 1.2, 34, 34, 2.4, 34, "amber");
  for (const [sx, sz] of [[191, 29], [235, 29], [191, 73], [235, 73]] as const)
    wire.circle(sx, PCB + 1.3, sz, 1.6, "xz", "d", 10);
  for (const [mx, mz] of [[190, 8], [212, 8], [234, 8], [190, 88], [212, 88], [234, 88], [166, 30], [166, 56]] as const)
    wire.box(mx, PCB, mz, 16, 1.6, 12, "d", false);
  for (let z = 10; z <= 92; z += 11) wire.box(246, PCB, z, 8, 4, 8, "d", false);
  for (let z = 12; z <= 90; z += 11) wire.box(257, PCB, z, 6, 2, 5, "d", false);
  for (const cz of [18, 40, 62, 84]) wire.cyl(240, PCB, cz, 2.6, 5.5, "d", 0, 12);

  // ---- pcie edge: gold fingers with the key notch
  wire.seg([12, -0.1, 0], [30, -0.1, 0], "w");
  wire.seg([34, -0.1, 0], [101, -0.1, 0], "w");
  for (let x = 14; x < 99; x += 3.4) {
    if (x > 29 && x < 34.5) continue;
    wire.seg([x, 0, 0], [x, -4.5, 0], "d");
  }

  // ---- IO bracket: plate, vent slots, three display connectors
  wire.poly([[0, -8, 0], [0, 48, 0], [0, 48, DEP * 0.36], [0, -8, DEP * 0.36]], "d");
  for (let vy = 2; vy <= 40; vy += 5.5) wire.seg([0, vy, 26], [0, vy, 38], "d");
  for (const [cy, ch] of [[4, 10], [18, 10], [32, 7]] as const)
    wire.poly([[-1, cy, 6], [-1, cy + ch, 6], [-1, cy + ch, 22], [-1, cy, 22]], "d");

  // ---- power: two 8-pin sockets with pin lattices
  for (const px of [210, 236]) {
    wire.box(px, PCB + 2.4, -0.5, 22, 9, 7, "d");
    for (let c = 1; c < 4; c++) wire.seg([px + c * 5.5, PCB + 2.4, -0.5], [px + c * 5.5, PCB + 11.4, -0.5], "d");
    wire.seg([px, PCB + 6.9, -0.5], [px + 22, PCB + 6.9, -0.5], "d");
  }

  const { group } = wire.build(mats);

  // fans: rings static, blade sets in their own spinning groups
  const fanY = PCB + SH.h + 0.1;
  const spinners: Group[] = [];
  for (const fx of [45, 131]) {
    const ring = new Wire();
    // frame square + screw bosses + double ring + static struts under the blades
    ring.poly([[-43, 0, -43], [43, 0, -43], [43, 0, 43], [-43, 0, 43]], "d");
    for (const [cx, cz] of [[-38, -38], [38, -38], [38, 38], [-38, 38]] as const)
      ring.circle(cx, 0, cz, 2.5, "xz", "d", 10);
    ring.circle(0, 0, 0, 42, "xz", "w");
    ring.circle(0, 0, 0, 39, "xz", "d");
    for (let s = 0; s < 4; s++) {
      const a = (s / 4) * Math.PI * 2 + 0.4;
      ring.seg([Math.cos(a) * 11, -1, Math.sin(a) * 11], [Math.cos(a) * 39, -1, Math.sin(a) * 39], "d");
    }
    const rr = ring.build(mats);
    rr.group.position.set(fx, fanY, DEP / 2);
    group.add(rr.group);

    const blades = new Wire();
    blades.circle(0, 0, 0, 11, "xz", "w");
    blades.circle(0, 0.8, 0, 7.5, "xz", "d");
    for (let b = 0; b < 9; b++) {
      const a0 = (b / 9) * Math.PI * 2;
      const pts: P3[] = [];
      for (let k = 0; k <= 6; k++) {
        const ang = a0 + (k / 6) * 0.62;
        const r = 12 + (k / 6) * 26;
        pts.push([Math.cos(ang) * r, 0, Math.sin(ang) * r]);
      }
      blades.poly(pts, "d", false);
    }
    const bb = blades.build(mats);
    bb.group.position.set(fx, fanY, DEP / 2);
    group.add(bb.group);
    spinners.push(bb.group);
  }

  // heat wisps drifting off the fin stack
  const R = rng(11);
  const wispBase: [number, number][] = [];
  const wpos: number[] = [];
  for (let i = 0; i < 24; i++) {
    const x = 10 + R() * 158, z = DEP + 2 + R() * 6;
    wispBase.push([x, z]);
    wpos.push(x, 44, z);
  }
  const wg = new BufferGeometry();
  wg.setAttribute("position", new Float32BufferAttribute(wpos, 3));
  const wm = new PointsMaterial({ color: 0xb0672a, size: 0.09, transparent: true, opacity: 0.4, depthWrite: false });
  mats.push({ m: wm as unknown as LineBasicMaterial, base: 0.4, tag: "" });
  const wisps = new Points(wg, wm);
  group.add(wisps);

  group.scale.setScalar(0.03);
  group.position.set(-4, -0.55, -1.68);

  const def: StageDef = {
    group, mats, labels: [],
    kfs: [
      { p: 0, pos: [9.5, 6.2, 8.6], look: [0, -0.2, 0] },
      { p: 0.45, pos: [7.2, 3.2, 5.8], look: [1.2, -0.3, -0.1] },
      { p: 0.78, pos: [4.3, 1.9, 2.9], look: [2.3, -0.4, -0.15] },
      { p: 1, pos: [2.75, 0.75, 0.4], look: [2.39, -0.37, -0.15] },
    ],
    update: (f, t, dt) => {
      void dt;
      const boost = Math.min(10, (group.userData.vel ?? 0) * 55);
      for (const sp of spinners) sp.rotation.y = -(t * (3.2 + boost));
      const p = wisps.geometry.getAttribute("position");
      for (let i = 0; i < wispBase.length; i++) {
        const y = 44 + ((t * 16 + i * 9.7) % 90);
        p.setXYZ(i, wispBase[i][0] + Math.sin(t * 0.9 + i) * 3, y, wispBase[i][1]);
      }
      p.needsUpdate = true;
      void f;
    },
    target: [213, 6, 51],
    reticleLbl: "THE DIE",
    reticleFrom: 0.55,
  };
  def.labels = mkLabels(def, [
    { text: "AXIAL FANS · 92 MM ×2", anchor: [46, 48, 56], side: -1 },
    { text: "FIN STACK · VAPOR CHAMBER", anchor: [88, 22, 112], side: -1 },
    { text: "GDDR7", anchor: [188, 8, 14], side: 1 },
    { text: "PCIE 5.0 ×16", anchor: [56, -5, 0], side: 1 },
    { text: "GPU DIE · DIVE TARGET", anchor: [213, 9, 51], amber: true, side: 1, alpha: f => smooth((f - 0.28) / 0.1) * (1 - smooth((f - 0.52) / 0.08)) },
  ]);
  return def;
}

// ==================================================================== S2
// the package in 3D: interposer, 8 HBM stacks, chiplet grid, BGA — with
// clock pulses racing the HBM→die traces.
function buildPackage(): StageDef {
  const mats: Mat[] = [];
  const wire = new Wire();

  wire.box(-5, -0.5, -4.5, 10, 0.5, 9, "w");                 // substrate
  wire.box(-4, 0, -3.5, 8, 0.22, 7, "d", false);             // interposer
  // HBM stacks: 4 per side, stepped dies
  for (let i = 0; i < 4; i++) {
    for (const sx of [-1, 1]) {
      const x = sx * 3.15 - 0.7, z = -3.15 + i * 1.7;
      wire.box(x, 0.22, z, 1.4, 0.72, 1.45, "w");
      for (let l = 1; l < 4; l++) {
        const y = 0.22 + (0.72 * l) / 4;
        wire.seg([x, y, z + 1.45], [x + 1.4, y, z + 1.45], "d");
        wire.seg([x + 1.4, y, z], [x + 1.4, y, z + 1.45], "d");
      }
    }
  }
  // compute die + 2×4 chiplets
  wire.box(-1.35, 0.22, -3.3, 2.7, 0.16, 6.6, "w");
  for (let r = 0; r < 4; r++) for (let c = 0; c < 2; c++)
    wire.box(-1.2 + c * 1.25, 0.38, -3.12 + r * 1.65, 1.1, 0.1, 1.42, "d", false);
  // amber cell grid on the two middle chiplets
  for (let gx = 0; gx <= 8; gx++) wire.seg([-1.1 + gx * 0.27, 0.5, -1.35], [-1.1 + gx * 0.27, 0.5, 1.35], gx % 4 === 0 ? "amber" : "d");
  for (let gz = 0; gz <= 10; gz++) wire.seg([-1.1, 0.5, -1.35 + gz * 0.27], [1.06, 0.5, -1.35 + gz * 0.27], gz % 5 === 0 ? "amber" : "d");
  // caps along the front edge + BGA balls under the rim
  for (let x = -4.6; x < 4.6; x += 0.55) wire.box(x, -0.5 - 0.14, 4.05, 0.3, 0.14, 0.2, "d", false);
  for (let x = -4.7; x < 4.8; x += 0.42) { wire.seg([x, -0.5, -4.4], [x, -0.68, -4.4], "d"); wire.seg([x, -0.5, 4.4], [x, -0.68, 4.4], "d"); }
  for (let z = -4.2; z < 4.3; z += 0.42) { wire.seg([-4.95, -0.5, z], [-4.95, -0.68, z], "d"); wire.seg([4.95, -0.5, z], [4.95, -0.68, z], "d"); }

  const { group } = wire.build(mats);

  // clock pulses: points lerping along HBM→die traces
  const paths: [Vector3, Vector3][] = [];
  for (let i = 0; i < 4; i++) {
    const z = -2.4 + i * 1.7;
    paths.push([new Vector3(-2.45, 0.3, z), new Vector3(-1.35, 0.3, z)]);
    paths.push([new Vector3(2.45, 0.3, z), new Vector3(1.35, 0.3, z)]);
  }
  for (const [pa, pb] of paths) wire.seg([pa.x, pa.y, pa.z], [pb.x, pb.y, pb.z], "d");
  const ppos: number[] = [];
  for (let i = 0; i < 12; i++) ppos.push(0, 0.3, 0);
  const pg = new BufferGeometry();
  pg.setAttribute("position", new Float32BufferAttribute(ppos, 3));
  const pm = new PointsMaterial({ color: 0xf59e0b, size: 0.1, transparent: true, opacity: 0.9, depthWrite: false });
  mats.push({ m: pm as unknown as LineBasicMaterial, base: 0.9, tag: "" });
  const pulses = new Points(pg, pm);
  group.add(pulses);

  const def: StageDef = {
    group, mats, labels: [],
    kfs: [
      { p: 0, pos: [0.5, 8.8, 4.2], look: [0, 0, 0] },
      { p: 0.5, pos: [5.6, 4.6, 5.4], look: [0, 0.1, 0] },
      { p: 0.8, pos: [2.4, 2.4, 2.6], look: [0, 0.35, 0] },
      { p: 1, pos: [0.35, 1.35, 1.05], look: [0, 0.45, 0] },
    ],
    update: (f, t) => {
      void f;
      const p = pulses.geometry.getAttribute("position");
      for (let i = 0; i < 12; i++) {
        const [pa, pb] = paths[i % paths.length];
        const u = (t * 0.55 + i * 0.37) % 1;
        p.setXYZ(i, lerp(pa.x, pb.x, u), 0.34, lerp(pa.z, pb.z, u));
      }
      p.needsUpdate = true;
    },
    target: [0, 0.5, 0],
    reticleLbl: "1,048,576 CELLS",
    reticleFrom: 0.5,
  };
  def.labels = mkLabels(def, [
    { text: "HBM STACKS ×8", anchor: [-3.6, 1.1, -2.4], side: -1 },
    { text: "COMPUTE CHIPLETS ×8", anchor: [1.3, 0.6, -3.0], side: 1 },
    { text: "φ · T · c · AGE, 128 BIT / CELL", anchor: [1.1, 0.55, 0.6], side: 1 },
    { text: "TWO PASSES PER TIME-STEP · WGSL", anchor: [0.4, 0.4, 3.5], side: 1 },
  ]);
  return def;
}

// ==================================================================== S3
// the SEM column — assembled, then EXPLODED apart with labeled callouts
// (the anime.js lens moment), the beam drawn through the bores, and the
// camera diving into the chamber.
function buildColumn(): StageDef {
  const mats: Mat[] = [];
  const root = new Group();

  interface Part { g: Group; home: number; spread: number }
  const parts: Part[] = [];
  const addPart = (build: (w: Wire) => void, home: number, spread: number, tag = "") => {
    const w = new Wire();
    build(w);
    const { group } = w.build(mats, tag);
    group.position.y = home;
    root.add(group);
    parts.push({ g: group, home, spread });
    return group;
  };

  // electron gun
  addPart(w => {
    w.cyl(0, 0, 0, 0.75, 1.1, "w", 8);
    w.circle(0, 1.1, 0, 0.45, "xz", "d");
    w.seg([-0.28, 0.55, 0], [0, 0.12, 0], "w");
    w.seg([0.28, 0.55, 0], [0, 0.12, 0], "w");
    w.circle(0, 0, 0, 0.3, "xz", "d");
  }, 7.9, 1.7);
  // anode disc
  addPart(w => {
    w.circle(0, 0, 0, 1.05, "xz", "w");
    w.circle(0, 0, 0, 0.28, "xz", "amber");
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      w.seg([Math.cos(a) * 0.3, 0, Math.sin(a) * 0.3], [Math.cos(a) * 1.03, 0, Math.sin(a) * 1.03], "d");
    }
  }, 7.05, 1.25);
  // condenser lenses ×2
  const condenser = (w: Wire) => {
    w.cyl(0, -0.3, 0, 1.25, 0.6, "w", 0, 40);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      w.seg([Math.cos(a) * 1.25, -0.3, Math.sin(a) * 1.25], [Math.cos(a) * 1.25, 0.3, Math.sin(a) * 1.25], "d");
    }
    w.circle(0, 0.05, 0, 0.5, "xz", "d");
    w.circle(0, -0.05, 0, 0.5, "xz", "d");
  };
  addPart(condenser, 6.2, 0.85);
  addPart(condenser, 5.3, 0.5);
  // scan coils
  addPart(w => {
    for (const sx of [-1, 1]) {
      w.box(sx * 0.95 - 0.24, -0.26, -0.24, 0.48, 0.52, 0.48, "w");
      w.circle(sx * 0.95, 0, 0, 0.33, "yz", "d", 20);
    }
    w.circle(0, 0, 0, 1.3, "xz", "d", 40);
  }, 4.45, 0.18);
  // objective lens + aperture
  addPart(w => {
    w.cyl(0, -0.42, 0, 1.5, 0.84, "w", 0, 44);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      w.seg([Math.cos(a) * 1.5, -0.42, Math.sin(a) * 1.5], [Math.cos(a) * 1.5, 0.42, Math.sin(a) * 1.5], "d");
    }
    // conic pole piece down to the bore
    w.circle(0, -0.42, 0, 1.0, "xz", "d");
    w.circle(0, -0.75, 0, 0.35, "xz", "w");
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      w.seg([Math.cos(a) * 1.0, -0.42, Math.sin(a) * 1.0], [Math.cos(a) * 0.35, -0.75, Math.sin(a) * 0.35], "d");
    }
    w.box(-0.65, -0.95, -0.14, 1.3, 0.1, 0.28, "d");
  }, 3.5, -0.25);
  // specimen chamber
  const chamber = addPart(w => {
    // open box: bottom + 4 walls, no top
    const s = 2.2, h = 2.1;
    w.poly([[-s, 0, -s], [s, 0, -s], [s, 0, s], [-s, 0, s]], "w");
    for (const [x, z] of [[-s, -s], [s, -s], [s, s], [-s, s]] as const) w.seg([x, 0, z], [x, h, z], "w");
    w.poly([[-s, h, -s], [s, h, -s], [s, h, s], [-s, h, s]], "d");
    // stage pedestal + specimen puck
    w.box(-0.5, 0, -0.5, 1, 0.55, 1, "d");
    w.cyl(0, 0.55, 0, 0.42, 0.28, "amber", 0, 28);
    // door hatch lines on the front wall
    w.seg([-1.2, 0.3, s], [1.2, 0.3, s], "d");
    w.seg([-1.2, 1.7, s], [1.2, 1.7, s], "d");
    w.seg([-1.2, 0.3, s], [-1.2, 1.7, s], "d");
    w.seg([1.2, 0.3, s], [1.2, 1.7, s], "d");
    // SE detector cone poking in
    w.poly([[1.9, 1.35, 0.9], [2.2, 1.5, 1.3], [2.2, 1.2, 1.3]], "w");
  }, 0, -0.8);
  // outer casing: fades away as the explode begins
  addPart(w => {
    w.cyl(0, 0, 0, 1.85, 6.3, "w", 8);
    w.circle(0, 2.1, 0, 1.85, "xz", "d");
    w.circle(0, 4.2, 0, 1.85, "xz", "d");
    w.circle(0, -0.25, 0, 2.1, "xz", "d");
  }, 2.55, 0, "casing");

  // the beam: drawn segment-by-segment through every bore once exploded
  const beamWire = new Wire();
  const BEAM_TOP = 8.0, BEAM_BOT = 0.86;
  const BEAM_N = 24;
  for (let i = 0; i < BEAM_N; i++) {
    const y0 = BEAM_TOP - ((BEAM_TOP - BEAM_BOT) * i) / BEAM_N;
    const y1 = BEAM_TOP - ((BEAM_TOP - BEAM_BOT) * (i + 1)) / BEAM_N;
    beamWire.seg([0, y0, 0], [0, y1, 0], "beam");
  }
  // scan cone at the bottom
  beamWire.seg([0, 2.2, 0], [-0.34, BEAM_BOT, 0], "beam");
  beamWire.seg([0, 2.2, 0], [0.34, BEAM_BOT, 0], "beam");
  const beamB = beamWire.build(mats, "beam");
  const beamLines = beamB.lines.beam!;
  beamLines.geometry.setDrawRange(0, 0);
  root.add(beamB.group);

  // beam electrons
  const eg = new BufferGeometry();
  eg.setAttribute("position", new Float32BufferAttribute(new Array(5 * 3).fill(0), 3));
  const em = new PointsMaterial({ color: 0x9fe8ee, size: 0.11, transparent: true, opacity: 0, depthWrite: false });
  const electrons = new Points(eg, em);
  root.add(electrons);

  root.position.y = -4.3;

  // per-part explode phase, gently staggered top to bottom
  const eAmt = (f: number, idx: number) => smooth((f - 0.2 - idx * 0.03) / 0.32);

  const def: StageDef = {
    group: root, mats, labels: [],
    kfs: [
      { p: 0, pos: [7.9, 4.9, 10.2], look: [0, 0.4, 0] },
      { p: 0.3, pos: [9.4, 2.6, 5.2], look: [0, 0.9, 0] },
      { p: 0.55, pos: [5.2, -0.2, 5.4], look: [0, -0.3, 0] },
      { p: 0.8, pos: [2.3, -1.8, 2.7], look: [0, -2.4, 0] },
      { p: 1, pos: [0.55, -2.6, 1.0], look: [0, -3.4, 0] },
    ],
    update: (f, t) => {
      const fade: Record<string, number> = {};
      for (let i = 0; i < parts.length; i++) {
        const P = parts[i];
        P.g.position.y = P.home + P.spread * eAmt(f, i);
      }
      fade["casing"] = 1 - smooth((f - 0.14) / 0.18);
      root.userData.fade = fade;
      // beam draws once the column is open
      const bp = smooth((f - 0.58) / 0.2);
      beamLines.geometry.setDrawRange(0, Math.floor(bp * (BEAM_N + 2)) * 2);
      em.opacity = bp * 0.9 * (1 - smooth((f - 0.9) / 0.1));
      const p = electrons.geometry.getAttribute("position");
      for (let i = 0; i < 5; i++) {
        const u = (t * 0.7 + i * 0.2) % 1;
        p.setXYZ(i, 0, lerp(BEAM_TOP, BEAM_BOT, u), 0);
      }
      p.needsUpdate = true;
      void chamber;
    },
    target: [0, 0.72, 0],
    reticleLbl: "THE SPECIMEN",
    reticleFrom: 0.74,
  };

  // label anchors ride each part's LIVE (exploded) position: y is given in
  // column coordinates, so part-local y is y − home
  const partLbl = (text: string, idx: number, y: number, side: 1 | -1, x: number): LabelDef => ({
    text, side,
    anchor: () => parts[idx].g.localToWorld(new Vector3(x, y - parts[idx].home, 0)),
    alpha: (f: number) => eAmt(f, idx) * (1 - smooth((f - 0.72) / 0.1)),
  });
  def.labels = mkLabels(def, [
    { ...partLbl("ELECTRON GUN", 0, 8.45, 1, 0.8) },
    { ...partLbl("ANODE", 1, 7.05, -1, -1.1) },
    { ...partLbl("CONDENSER LENS 1", 2, 6.2, 1, 1.3) },
    { ...partLbl("CONDENSER LENS 2", 3, 5.3, -1, -1.3) },
    { ...partLbl("SCAN COILS", 4, 4.45, 1, 1.35) },
    { ...partLbl("OBJECTIVE LENS", 5, 3.5, -1, -1.55) },
    { ...partLbl("SPECIMEN CHAMBER", 6, 1.9, 1, 2.25) },
  ]);
  return def;
}

// ==================================================================== S4
// the specimen: a polished puck whose face is a real Voronoi grain network
// (d3-delaunay), twins hatched, one grain carrying the dendrite target.
function buildSpecimen(): StageDef {
  const mats: Mat[] = [];
  const R = rng(4242);
  const RAD = 4.35;

  // dart-throw seeds
  const pts: [number, number][] = [];
  while (pts.length < 26) {
    const x = (R() * 2 - 1) * 3.9, z = (R() * 2 - 1) * 3.9;
    if (x * x + z * z > 3.9 * 3.9) continue;
    if (pts.every(([px, pz]) => (px - x) ** 2 + (pz - z) ** 2 > 0.95)) pts.push([x, z]);
  }
  pts.push([1.6, 1.1]); // the target grain's seed
  const targetIdx = pts.length - 1;
  const del = Delaunay.from(pts);
  const vor = del.voronoi([-RAD, -RAD, RAD, RAD]);

  const clampR = (x: number, z: number): [number, number] => {
    const r = Math.hypot(x, z);
    if (r <= RAD - 0.1) return [x, z];
    const s = (RAD - 0.1) / r;
    return [x * s, z * s];
  };

  // collect deduped edges, sorted center-out for the draw-on ripple
  const edgeMap = new Map<string, { a: [number, number]; b: [number, number]; amber: boolean }>();
  for (let i = 0; i < pts.length; i++) {
    const poly = vor.cellPolygon(i);
    if (!poly) continue;
    for (let k = 0; k < poly.length - 1; k++) {
      const [ax, az] = clampR(poly[k][0], poly[k][1]);
      const [bx, bz] = clampR(poly[k + 1][0], poly[k + 1][1]);
      if (Math.hypot(ax - bx, az - bz) < 0.03) continue;
      const key = [ax.toFixed(2), az.toFixed(2), bx.toFixed(2), bz.toFixed(2)].sort().join("|");
      const prev = edgeMap.get(key);
      const amber = i === targetIdx;
      if (!prev) edgeMap.set(key, { a: [ax, az], b: [bx, bz], amber });
      else prev.amber = prev.amber || amber;
    }
  }
  const edges = [...edgeMap.values()].sort((e1, e2) => {
    const d1 = Math.min(Math.hypot(...e1.a), Math.hypot(...e1.b));
    const d2 = Math.min(Math.hypot(...e2.a), Math.hypot(...e2.b));
    return d1 - d2;
  });

  const wire = new Wire();
  const births: number[] = [];
  edges.forEach((e, i) => {
    if (e.amber) return;
    wire.seg([e.a[0], 0.01, e.a[1]], [e.b[0], 0.01, e.b[1]], "d");
    births.push(i / edges.length);
  });

  // twin hatches inside three grains
  for (const gi of [3, 9, 15]) {
    const [cx, cz] = pts[gi];
    const th = R() * Math.PI;
    for (let k = -1; k <= 2; k++) {
      const off = k * 0.16;
      const dx = Math.cos(th), dz = Math.sin(th);
      wire.seg(
        [cx - dx * 0.5 - dz * off, 0.01, cz - dz * 0.5 + dx * off],
        [cx + dx * 0.5 - dz * off, 0.01, cz + dz * 0.5 + dx * off], "d");
    }
  }

  // rim, bottom, polishing arcs
  wire.circle(0, 0, 0, RAD, "xz", "w", 64);
  wire.circle(0, -0.9, 0, RAD, "xz", "d", 64);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    wire.seg([Math.cos(a) * RAD, 0, Math.sin(a) * RAD], [Math.cos(a) * RAD, -0.9, Math.sin(a) * RAD], "d");
  }
  for (const [r, a0, a1] of [[2.1, 0.4, 1.6], [3.2, 3.4, 4.3], [1.4, 4.9, 5.8]] as const)
    wire.circle(0, 0.015, 0, r, "xz", "d", 30, a0, a1);

  const built = wire.build(mats);
  const group = built.group;
  const gbLines = built.lines.d!;

  // target grain: amber boundary + a small dendrite root star
  const aw = new Wire();
  for (const e of edges) if (e.amber) aw.seg([e.a[0], 0.012, e.a[1]], [e.b[0], 0.012, e.b[1]], "amber");
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.2;
    aw.seg([1.6, 0.012, 1.1], [1.6 + Math.cos(a) * 0.34, 0.012, 1.1 + Math.sin(a) * 0.34], "amber");
  }
  group.add(aw.build(mats).group);

  const totalGB = births.length;

  const def: StageDef = {
    group, mats, labels: [],
    kfs: [
      { p: 0, pos: [0.4, 7.4, 7.6], look: [0, 0, 0] },
      { p: 0.45, pos: [3.5, 2.7, 5.1], look: [0.7, 0, 0.5] },
      { p: 0.75, pos: [2.7, 1.15, 2.65], look: [1.6, 0, 1.1] },
      { p: 1, pos: [1.98, 0.52, 1.42], look: [1.6, 0, 1.1] },
    ],
    update: (f) => {
      const g = smooth(f / 0.32);
      gbLines.geometry.setDrawRange(0, Math.floor(g * totalGB) * 2);
    },
    target: [1.6, 0, 1.1],
    reticleLbl: "THE DENDRITE",
    reticleFrom: 0.6,
  };
  def.labels = mkLabels(def, [
    { text: "GRAIN BOUNDARY", anchor: [-1.8, 0.1, -1.9], side: -1 },
    { text: "ANNEALING TWINS", anchor: [pts[9][0], 0.1, pts[9][1]], side: 1 },
    { text: "SECTION ≈ 500 µM", anchor: [-3.4, -0.45, 2.2], side: -1 },
  ]);
  return def;
}

// ==================================================================== S5
// the finale: the geometric dendrite crystallizing under the scroll —
// birth-sorted segments revealed through drawRange, camera in slow orbit.
function buildDendriteStage(): StageDef {
  const mats: Mat[] = [];
  const segs = genDendrite();

  const group = new Group();
  const byCls: Partial<Record<Cls, { lines: LineSegments; births: number[] }>> = {};
  for (const cls of ["w", "d", "amber"] as const) {
    const mine = segs.filter(s => s.cls === cls);
    if (!mine.length) continue;
    const w = new Wire();
    const births: number[] = [];
    for (const s of mine) { w.seg(s.a, s.b, cls); births.push(s.t); }
    const b = w.build(mats);
    const lines = b.lines[cls]!;
    lines.geometry.setDrawRange(0, 0);
    group.add(b.group);
    byCls[cls] = { lines, births };
  }

  // instrument dressing: a faint field ring + corner ticks live in 3D too
  const dress = new Wire();
  dress.circle(0, 0, 0, 4.9, "xz", "d", 72);
  for (const a of [0.5, 2.07, 3.64, 5.21]) {
    dress.seg([Math.cos(a) * 4.9, 0, Math.sin(a) * 4.9], [Math.cos(a) * 5.25, 0, Math.sin(a) * 5.25], "d");
  }
  group.add(dress.build(mats).group);

  const def: StageDef = {
    group, mats, labels: [],
    cam: (f, pos, look) => {
      // the crystal grows, the camera gives it room: a slow orbiting pull-out
      const az = 0.95 - f * 0.62;
      const r = 10.6 + smooth(f) * 2.9;
      const y = 5.2 + smooth(f) * 0.7;
      pos.set(Math.cos(az) * r, y, Math.sin(az) * r);
      look.set(0, 0.1, 0);
    },
    update: (f) => {
      const g = smooth((f - 0.03) / 0.8);
      for (const cls of ["w", "d", "amber"] as const) {
        const e = byCls[cls];
        if (!e) continue;
        e.lines.geometry.setDrawRange(0, upperBound(e.births, g) * 2);
      }
    },
  };
  def.labels = mkLabels(def, [
    { text: "PRIMARY ARM", anchor: [3.1, 0.15, 1.4], side: 1, alpha: f => smooth((f - 0.42) / 0.1) * (1 - smooth((f - 0.9) / 0.1)) },
    { text: "SECONDARY ARMS · λ₂", anchor: [-2.0, 0.15, 2.3], side: -1, alpha: f => smooth((f - 0.58) / 0.1) * (1 - smooth((f - 0.9) / 0.1)) },
    { text: "SIX-FOLD BECAUSE THE LATTICE IS", anchor: [0, 0.2, -3.6], side: 1, alpha: f => smooth((f - 0.72) / 0.1) },
  ]);
  return def;
}

// --------------------------------------------------------------- helpers
function mkLabels(def: StageDef, list: LabelDef[]): { def: LabelDef; el: HTMLElement }[] {
  void def;
  return list.map(d => ({ def: d, el: undefined as unknown as HTMLElement }));
}
