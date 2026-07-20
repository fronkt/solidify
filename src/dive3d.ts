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
  { field: "FIELD ≈ 10 MM", title: "THE CORES", sub: "One chiplet, thousands of lanes. Every cell of the melt maps to a thread; the freeze is one giant tensor op." },
  { field: "FIELD ≈ 400 MM", title: "THE ARC MELTER", sub: "Now the real metal. An arc jumps from the stinger to the button, remelting it on cold copper until it is uniform." },
  { field: "FIELD ≈ 150 MM", title: "THE POLISHER", sub: "Diamond slurry on a spinning platen, down to one micron. Grains only show on a mirror." },
  { field: "FIELD ≈ 5 MM", title: "THE MICROSCOPE", sub: "An electron column, taken apart. Gun, condensers, scan coils, objective: the optics that see metal at the micron." },
  { field: "FIELD ≈ 500 µM", title: "THE SPECIMEN", sub: "Grains, boundaries, dendrite arms: the structure that decides whether metal holds." },
  { field: "FIELD ≈ 50 µM", title: "THE DENDRITE", sub: "Anisotropy chooses the arms. Latent heat spaces them. The lab grows the real thing live in your browser." },
  { field: "FIELD ≈ 3 M", title: "THE TENSILE FRAME", sub: "Pull until it breaks. The dendrites you just watched grow decide where the crack goes and the number on the dial." },
  { field: "FIELD ≈ 200 M", title: "THE LIGHT SOURCE", sub: "To measure atoms you need a machine the size of a stadium. Electrons circle; X-rays fire down the beamline." },
  { field: "FIELD ≈ 2 M", title: "THE BEAMLINE", sub: "Inside the hutch: slits, a monochromator, the goniometer, and a detector catching rings. Each ring is a plane of atoms." },
  { field: "FIELD ≈ 1 NM", title: "THE LATTICE", sub: "Hexagonal close packing. The six-fold symmetry you watched all the way down starts here, atom by atom." },
  { field: "FIELD = ONE TAB", title: "ALL IN ONE", sub: "Arc melter, microscope, beamline, test frame. Every instrument on this page runs live in one browser tab. That is SOLIDIFY." },
];

// scroll weight per stage (the exploding column and the growing forms earn dwell)
const WEIGHTS = [1.15, 1.15, 1, 1.1, 1, 1.7, 1, 1.2, 1.15, 1.25, 1.3, 1.35, 1.3];

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
  scene.fog = new Fog(0x0b0d10, 18, 42);
  const camera = new PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 90);

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
    buildCard(), buildPackage(), buildCores(),
    buildArcMelter(), buildPolisher(),
    buildColumn(), buildSpecimen(), buildDendriteStage(),
    buildTensile(), buildSynchrotron(), buildBeamline(), buildLattice(), buildAllInOne(),
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
  const dashBox = document.getElementById("diveDashes")!;
  dashBox.innerHTML = "";
  for (let k = 0; k < META.length; k++) dashBox.append(document.createElement("i"));
  const dashEls = [...document.querySelectorAll<HTMLElement>("#diveDashes i")];
  const two = (n: number) => String(n).padStart(2, "0");
  let curHud = -1;
  const setHud = (i: number) => {
    if (i === curHud) return;
    curHud = i;
    const m = META[i];
    fieldEl.textContent = m.field;
    numEl.textContent = `${two(i + 1)} / ${two(META.length)}`;
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
    end: "+=19000",
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

  // ---- exposed pcb: package substrate, retention screws, GDDR ring, VRM
  // (the die itself is a hinged LID part: it swings open on approach and the
  // interposer + chiplets fade in underneath — the reveal Frank asked for)
  wire.box(188, PCB, 26, 50, 1.2, 50, "d", false);
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

  // die lid: hinged at its spine edge, lifts open as the camera closes
  const lidW = new Wire();
  lidW.box(-17, 0, 0, 34, 2.4, 34, "amber");
  const lid = lidW.build(mats, "lid").group;
  lid.position.set(213, PCB + 1.2, 34);
  group.add(lid);
  // what the lid hides: interposer + four chiplets + a hint of the cell grid
  const innerW = new Wire();
  innerW.box(200, PCB + 0.6, 38, 26, 0.5, 26, "d", false);
  for (const [ix, iz] of [[202, 40], [215, 40], [202, 53], [215, 53]] as const)
    innerW.box(ix, PCB + 1.1, iz, 11, 0.4, 11, "d", false);
  for (let k = 1; k < 4; k++) {
    innerW.seg([203 + k * 5.5, PCB + 1.6, 41], [203 + k * 5.5, PCB + 1.6, 63], "amber");
    innerW.seg([203, PCB + 1.6, 41 + k * 5.5], [225, PCB + 1.6, 41 + k * 5.5], "amber");
  }
  group.add(innerW.build(mats, "inner").group);

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
      // the reveal: lid swings open on approach, the guts fade in below it
      const open = smooth((f - 0.68) / 0.2);
      lid.rotation.x = -1.05 * open;
      lid.position.y = PCB + 1.2 + open * 2;
      group.userData.fade = {
        lid: 1 - smooth((f - 0.9) / 0.08),
        inner: smooth((f - 0.72) / 0.14),
      };
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
  // HBM↔die PHY lanes: hatch strips on the interposer
  for (let i = 0; i < 4; i++) {
    const z = -3.05 + i * 1.7;
    for (let k = 0; k < 6; k++) {
      wire.seg([-1.7 + 0, 0.24, z + k * 0.22], [-1.45, 0.24, z + k * 0.22], "d");
      wire.seg([1.45, 0.24, z + k * 0.22], [1.7, 0.24, z + k * 0.22], "d");
    }
  }
  // corner fiducials + silk rectangles on the substrate
  for (const [fx, fz] of [[-4.6, -4.1], [4.6, -4.1], [-4.6, 4.1], [4.6, 4.1]] as const)
    wire.circle(fx, 0.02, fz, 0.14, "xz", "d", 8);
  wire.poly([[-4.4, 0.02, -1.2], [-3.6, 0.02, -1.2], [-3.6, 0.02, 1.2], [-4.4, 0.02, 1.2]], "d");
  wire.poly([[3.6, 0.02, -1.2], [4.4, 0.02, -1.2], [4.4, 0.02, 1.2], [3.6, 0.02, 1.2]], "d");
  // caps along front AND back edges + BGA balls under the rim
  for (let x = -4.6; x < 4.6; x += 0.55) wire.box(x, -0.5 - 0.14, 4.05, 0.3, 0.14, 0.2, "d", false);
  for (let x = -4.3; x < 4.3; x += 0.75) wire.box(x, -0.5 - 0.14, -4.25, 0.3, 0.14, 0.2, "d", false);
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
    reticleLbl: "THE CHIPLETS",
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
// one chiplet's floorplan: SM array, L2 spine, memory PHY — and the amber
// solver core where the phase-field kernel actually runs.
function buildCores(): StageDef {
  const mats: Mat[] = [];
  const wire = new Wire();

  wire.box(-4.5, 0, -3.5, 9, 0.12, 7, "w");
  // L2 spine with hatch
  wire.poly([[-0.9, 0.14, -3.1], [0.9, 0.14, -3.1], [0.9, 0.14, 3.1], [-0.9, 0.14, 3.1]], "d");
  for (let z = -2.9; z <= 2.9; z += 0.4) wire.seg([-0.9, 0.14, z], [0.9, 0.14, z], "d");
  // SM blocks: 3 cols × 6 rows per side, each with 2×2 sub-units
  const smAt = (x0: number, z0: number, amber: boolean) => {
    const cls: Cls = amber ? "amber" : "d";
    wire.poly([[x0, 0.15, z0], [x0 + 0.95, 0.15, z0], [x0 + 0.95, 0.15, z0 + 0.9], [x0, 0.15, z0 + 0.9]], cls);
    if (amber) {
      for (let k = 1; k < 4; k++) {
        wire.seg([x0 + k * 0.24, 0.16, z0], [x0 + k * 0.24, 0.16, z0 + 0.9], "amber");
        wire.seg([x0, 0.16, z0 + k * 0.22], [x0 + 0.95, 0.16, z0 + k * 0.22], "amber");
      }
    } else {
      wire.seg([x0 + 0.47, 0.15, z0], [x0 + 0.47, 0.15, z0 + 0.9], "d");
      wire.seg([x0, 0.15, z0 + 0.45], [x0 + 0.95, 0.15, z0 + 0.45], "d");
    }
  };
  for (let c = 0; c < 3; c++) for (let r = 0; r < 6; r++) {
    smAt(-4.2 + c * 1.05, -3.15 + r * 1.05, false);
    smAt(1.15 + c * 1.05, -3.15 + r * 1.05, c === 0 && r === 2);
  }
  // memory PHY ticks on the long edges + frontend strip on the left
  for (let x = -4.3; x < 4.3; x += 0.28) {
    wire.seg([x, 0.14, -3.45], [x, 0.14, -3.2], "d");
    wire.seg([x, 0.14, 3.2], [x, 0.14, 3.45], "d");
  }
  for (let z = -3.0; z <= 3.0; z += 0.5) wire.seg([-4.45, 0.14, z], [-4.28, 0.14, z], "d");

  const { group } = wire.build(mats);

  // instruction stream: pulses running the L2 lanes
  const lanes = [-0.55, -0.18, 0.18, 0.55];
  const ppos: number[] = [];
  for (let i = 0; i < 10; i++) ppos.push(0, 0.2, 0);
  const pg = new BufferGeometry();
  pg.setAttribute("position", new Float32BufferAttribute(ppos, 3));
  const pm = new PointsMaterial({ color: 0xf59e0b, size: 0.09, transparent: true, opacity: 0.9, depthWrite: false });
  mats.push({ m: pm as unknown as LineBasicMaterial, base: 0.9, tag: "" });
  const pulses = new Points(pg, pm);
  group.add(pulses);

  const TGT: P3 = [1.63, 0.16, -0.6];
  const def: StageDef = {
    group, mats, labels: [],
    kfs: [
      { p: 0, pos: [0.4, 9.6, 4.2], look: [0, 0, 0] },
      { p: 0.5, pos: [4.4, 4.6, 4.4], look: [0.5, 0, -0.4] },
      { p: 0.8, pos: [2.7, 2.0, 0.6], look: [TGT[0], 0, TGT[2]] },
      { p: 1, pos: [2.0, 0.85, -0.15], look: [TGT[0], 0, TGT[2]] },
    ],
    update: (f, t) => {
      void f;
      const p = pulses.geometry.getAttribute("position");
      for (let i = 0; i < 10; i++) {
        const u = (t * 0.4 + i * 0.23) % 1;
        p.setXYZ(i, lanes[i % lanes.length], 0.2, -3.1 + u * 6.2);
      }
      p.needsUpdate = true;
    },
    target: TGT,
    reticleLbl: "1,048,576 CELLS",
    reticleFrom: 0.55,
  };
  def.labels = mkLabels(def, [
    { text: "STREAMING MULTIPROCESSORS ×36", anchor: [-2.7, 0.3, -2.2], side: -1 },
    { text: "L2 · THE FIELD LIVES HERE", anchor: [0, 0.3, 2.4], side: 1 },
    { text: "MEMORY PHY", anchor: [3.4, 0.3, 3.4], side: 1 },
    { text: "THE SOLVER CORE", anchor: [1.63, 0.3, -0.6], amber: true, side: 1, alpha: f => smooth((f - 0.3) / 0.1) * (1 - smooth((f - 0.52) / 0.08)) },
  ]);
  return def;
}

// ==================================================================== S5
// the arc melter: a stinger, a water-cooled copper hearth, and a flickering
// arc remelting the button under argon.
function buildArcMelter(): StageDef {
  const mats: Mat[] = [];
  const wire = new Wire();

  // chamber on legs, domed top, viewport
  wire.cyl(0, 0.8, 0, 1.6, 2.2, "w", 10);
  wire.circle(0, 3.25, 0, 1.0, "xz", "w", 32);
  wire.circle(0, 3.42, 0, 0.4, "xz", "w", 20);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    wire.seg([Math.cos(a) * 1.6, 3.0, Math.sin(a) * 1.6], [Math.cos(a) * 1.0, 3.25, Math.sin(a) * 1.0], "d");
    wire.seg([Math.cos(a) * 1.0, 3.25, Math.sin(a) * 1.0], [Math.cos(a) * 0.4, 3.42, Math.sin(a) * 0.4], "d");
  }
  for (const [lx, lz] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]] as const)
    wire.seg([lx, 0.8, lz], [lx * 1.15, 0, lz * 1.15], "w");
  wire.circle(0, 1.9, 1.61, 0.5, "xy", "w", 24);
  wire.circle(0, 1.9, 1.63, 0.62, "xy", "d", 24);
  // stinger entering through the gland at an angle
  wire.circle(0.75, 3.44, 0, 0.18, "xz", "d", 12);
  wire.seg([1.15, 4.6, 0], [0.78, 3.5, 0], "w");
  wire.seg([0.78, 3.5, 0], [0.2, 2.25, 0.1], "w");
  // hearth plate with four dimples, three dim buttons
  wire.circle(0, 1.05, 0, 1.2, "xz", "w", 36);
  for (const [dx, dz] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5]] as const) {
    wire.circle(dx, 1.06, dz, 0.28, "xz", "d", 16);
    wire.circle(dx, 1.1, dz, 0.16, "xz", "d", 12);
  }
  wire.circle(0.35, 1.06, 0.25, 0.28, "xz", "d", 16);
  // the live button, amber
  wire.circle(0.35, 1.1, 0.25, 0.17, "xz", "amber", 14);
  wire.circle(0.35, 1.16, 0.25, 0.1, "xz", "amber", 10);
  // water cooling loops at the base
  wire.poly([[-1.7, 0.55, -0.6], [-2.4, 0.55, -0.6], [-2.4, 0.3, 0.6], [-1.7, 0.3, 0.6]], "d", false);

  const { group } = wire.build(mats);

  // the arc: jagged, regenerated every frame, flickering
  const ag = new BufferGeometry();
  ag.setAttribute("position", new Float32BufferAttribute(new Array(6 * 3).fill(0), 3));
  const am = new LineBasicMaterial({ color: 0x9fe8ee, transparent: true, opacity: 0.9, depthWrite: false });
  mats.push({ m: am, base: 0.9, tag: "arc" });
  const arc = new LineSegments(ag, am);
  group.add(arc);
  const AR = rng(7);

  const TGT: P3 = [0.35, 1.15, 0.25];
  const def: StageDef = {
    group, mats, labels: [],
    kfs: [
      { p: 0, pos: [7.8, 5.0, 7.8], look: [0, 1.7, 0] },
      { p: 0.4, pos: [4.7, 3.2, 4.1], look: [0, 1.8, 0] },
      { p: 0.75, pos: [2.2, 2.3, 2.2], look: [0.3, 1.6, 0.2] },
      { p: 1, pos: [1.15, 1.7, 1.05], look: TGT },
    ],
    update: (f, t) => {
      void f;
      // rebuild the jag: tip (0.2,2.25,0.1) → button, 3 segments with noise
      const p = arc.geometry.getAttribute("position");
      const tip = [0.2, 2.25, 0.1], bot = [0.35, 1.16, 0.25];
      let px = tip[0], py = tip[1], pz = tip[2];
      for (let s = 0; s < 3; s++) {
        const u = (s + 1) / 3;
        const nx = u === 1 ? bot[0] : lerp(tip[0], bot[0], u) + (AR() - 0.5) * 0.22;
        const ny = u === 1 ? bot[1] : lerp(tip[1], bot[1], u) + (AR() - 0.5) * 0.1;
        const nz = u === 1 ? bot[2] : lerp(tip[2], bot[2], u) + (AR() - 0.5) * 0.22;
        p.setXYZ(s * 2, px, py, pz);
        p.setXYZ(s * 2 + 1, nx, ny, nz);
        px = nx; py = ny; pz = nz;
      }
      p.needsUpdate = true;
      group.userData.fade = { arc: 0.55 + 0.45 * Math.abs(Math.sin(t * 23) * Math.sin(t * 7.3)) };
    },
    target: TGT,
    reticleLbl: "THE BUTTON",
    reticleFrom: 0.6,
  };
  def.labels = mkLabels(def, [
    { text: "TUNGSTEN STINGER", anchor: [1.15, 4.5, 0], side: 1 },
    { text: "AR ATMOSPHERE", anchor: [0, 2.1, 1.62], side: 1 },
    { text: "WATER-COOLED COPPER HEARTH", anchor: [-1.15, 1.05, -0.35], side: -1 },
    { text: "THE BUTTON · DIVE TARGET", anchor: [0.35, 1.3, 0.25], amber: true, side: 1, alpha: f => smooth((f - 0.34) / 0.1) * (1 - smooth((f - 0.52) / 0.08)) },
  ]);
  return def;
}

// ==================================================================== S12
// the tensile frame: the payoff question. The dogbone stretches, necks,
// and fractures — where the grains you watched grow decide it would.
function buildTensile(): StageDef {
  const mats: Mat[] = [];
  const wire = new Wire();

  // base, twin columns, fixed top crosshead
  wire.box(-2.2, 0, -1.2, 4.4, 0.6, 2.4, "w");
  wire.cyl(-1.5, 0.6, 0, 0.22, 4.4, "w", 4, 16);
  wire.cyl(1.5, 0.6, 0, 0.22, 4.4, "w", 4, 16);
  wire.box(-2.0, 5.0, -0.7, 4.0, 0.5, 1.4, "w");
  // lower grip on the base
  wire.box(-0.35, 1.1, -0.3, 0.7, 0.7, 0.6, "w");
  wire.seg([-0.35, 1.55, -0.3], [0.35, 1.55, -0.3], "d");
  // console with live readout
  wire.box(2.6, 0, 0.2, 0.9, 2.6, 0.7, "w");
  wire.poly([[2.65, 2.0, 0.15], [3.45, 2.0, 0.15], [3.45, 1.4, 0.15], [2.65, 1.4, 0.15]], "d");

  const { group } = wire.build(mats);

  // moving crosshead with load cell + upper grip
  const chW = new Wire();
  chW.box(-2.0, 0, -0.7, 4.0, 0.45, 1.4, "w");
  chW.box(-0.3, -0.5, -0.25, 0.6, 0.5, 0.5, "d");
  chW.box(-0.35, -1.2, -0.3, 0.7, 0.7, 0.6, "w");
  const crosshead = chW.build(mats).group;
  crosshead.position.y = 3.4;
  group.add(crosshead);

  // the dogbone, in two halves that meet at a jagged fracture line (y=2.42)
  const jag: P3[] = [[-0.14, 2.42, 0], [-0.05, 2.36, 0], [0.04, 2.45, 0], [0.14, 2.4, 0]];
  const lowW = new Wire();
  lowW.poly([[-0.3, 1.8, 0], [0.3, 1.8, 0], [0.3, 2.0, 0], [0.14, 2.12, 0], [0.14, 2.4, 0]], "amber", false);
  lowW.poly([[-0.3, 1.8, 0], [-0.3, 2.0, 0], [-0.14, 2.12, 0], [-0.14, 2.42, 0]], "amber", false);
  for (let i = 0; i < jag.length - 1; i++) lowW.seg(jag[i], jag[i + 1], "amber");
  const lower = lowW.build(mats).group;
  group.add(lower);
  const upW = new Wire();
  upW.poly([[-0.3, 3.05, 0], [0.3, 3.05, 0], [0.3, 2.85, 0], [0.14, 2.73, 0], [0.14, 2.45, 0]], "amber", false);
  upW.poly([[-0.3, 3.05, 0], [-0.3, 2.85, 0], [-0.14, 2.73, 0], [-0.14, 2.43, 0]], "amber", false);
  for (let i = 0; i < jag.length - 1; i++) upW.seg([jag[i][0], 4.85 - jag[i][1], 0], [jag[i + 1][0], 4.85 - jag[i + 1][1], 0], "amber");
  const upper = upW.build(mats).group;
  group.add(upper);
  // extensometer clipped to the gauge
  const exW = new Wire();
  exW.box(0.2, 2.15, -0.14, 0.3, 0.5, 0.28, "d");
  exW.seg([0.2, 2.25, 0], [0.14, 2.25, 0], "d");
  exW.seg([0.2, 2.55, 0], [0.14, 2.55, 0], "d");
  const exten = exW.build(mats, "ext").group;
  group.add(exten);

  const TGT: P3 = [0, 2.45, 0];
  const def: StageDef = {
    group, mats, labels: [],
    kfs: [
      { p: 0, pos: [7.9, 5.0, 8.2], look: [0, 2.6, 0] },
      { p: 0.4, pos: [4.8, 3.4, 4.4], look: [0, 2.6, 0] },
      { p: 0.75, pos: [2.2, 2.8, 2.1], look: [0, 2.5, 0] },
      { p: 1, pos: [1.0, 2.55, 0.95], look: TGT },
    ],
    update: (f) => {
      // elastic-plastic pull, then the snap
      const pull = smooth((f - 0.2) / 0.4) * 0.22;
      const snap = smooth((f - 0.66) / 0.07);
      crosshead.position.y = 3.4 + pull + snap * 0.3;
      upper.position.y = pull + snap * 0.3;
      lower.position.y = -snap * 0.05;
      group.userData.fade = { ext: 1 - snap };
    },
    target: TGT,
    reticleLbl: "THE FRACTURE",
    reticleFrom: 0.74,
  };
  def.labels = mkLabels(def, [
    { text: "100 KN LOAD FRAME", anchor: [-1.5, 4.6, 0], side: -1 },
    { text: "EXTENSOMETER", anchor: [0.5, 2.4, 0], side: 1, alpha: f => smooth((f - 0.2) / 0.1) * (1 - smooth((f - 0.6) / 0.08)) },
    { text: "12.4 KN · 3.1 % STRAIN", anchor: [3.05, 2.1, 0.15], side: 1, alpha: f => smooth((f - 0.3) / 0.1) * (1 - smooth((f - 0.72) / 0.08)) },
    { text: "THE FRACTURE · DIVE TARGET", anchor: [0.2, 2.42, 0], amber: true, side: 1, alpha: f => smooth((f - 0.72) / 0.06) * (1 - smooth((f - 0.88) / 0.08)) },
  ]);
  return def;
}

// ==================================================================== S14
// the beamline endstation, inside the hutch the light source aimed at:
// slits → monochromator → goniometer → area detector catching rings.
// Not the microscope: electrons image shape, X-rays measure spacing.
function buildBeamline(): StageDef {
  const mats: Mat[] = [];
  const wire = new Wire();

  // the hutch itself: floor grid, three walls, sliding door, warning lamp
  {
    const HW = 4.4, HD = 5.6, HH = 3.1;
    wire.poly([[-HW, 0, -HD], [HW, 0, -HD], [HW, 0, HD], [-HW, 0, HD]], "d");
    for (const [x0, z0, x1, z1] of [[-HW, -HD, -HW, HD], [-HW, -HD, HW, -HD], [HW, -HD, HW, HD]] as const)
      wire.poly([[x0, 0, z0], [x1, 0, z1], [x1, HH, z1], [x0, HH, z0]], "d");
    for (let x = -HW + 1.1; x < HW; x += 1.1) wire.seg([x, 0, -HD], [x, 0, HD], "d");
    // door gap in the +x wall + slid-open panel
    wire.poly([[HW, 0, 1.1], [HW, 2.5, 1.1], [HW, 2.5, 2.6], [HW, 0, 2.6]], "w");
    wire.seg([HW, 1.3, 1.1], [HW, 1.3, 2.6], "d");
    // beam-on lamp over the door
    wire.circle(HW - 0.02, 2.75, 1.85, 0.14, "yz", "amber", 10);
  }
  // optical table (beam runs along +z)
  wire.box(-1.5, 0, -4.6, 3.0, 0.5, 9.2, "w");
  for (let z = -4.2; z < 4.4; z += 0.8) wire.seg([-1.4, 0.51, z], [1.4, 0.51, z], "d");
  // entrance pipe + slits
  wire.circle(0, 1.15, -4.55, 0.28, "xy", "w", 20);
  wire.circle(0, 1.15, -3.7, 0.28, "xy", "w", 20);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    wire.seg([Math.cos(a) * 0.28, 1.15 + Math.sin(a) * 0.28, -4.55], [Math.cos(a) * 0.28, 1.15 + Math.sin(a) * 0.28, -3.7], "d");
  }
  wire.box(-0.5, 0.5, -3.4, 0.42, 1.1, 0.25, "w");
  wire.box(0.08, 0.5, -3.4, 0.42, 1.1, 0.25, "w");
  // monochromator box with two tilted crystals
  wire.box(-0.7, 0.5, -2.9, 1.4, 1.2, 1.3, "w");
  wire.poly([[-0.35, 0.95, -2.7], [0.35, 1.1, -2.7], [0.35, 1.1, -2.3], [-0.35, 0.95, -2.3]], "d");
  wire.poly([[-0.35, 1.35, -2.2], [0.35, 1.2, -2.2], [0.35, 1.2, -1.8], [-0.35, 1.35, -1.8]], "d");
  // ion chamber
  wire.circle(0, 1.15, -1.3, 0.2, "xy", "d", 14);
  wire.circle(0, 1.15, -0.85, 0.2, "xy", "d", 14);
  wire.seg([0.2, 1.15, -1.3], [0.2, 1.15, -0.85], "d");
  wire.seg([-0.2, 1.15, -1.3], [-0.2, 1.15, -0.85], "d");
  // goniometer: base, χ-cradle arc, φ ring — the sample at beam height
  wire.cyl(0, 0.5, 1.2, 0.7, 0.3, "w", 8, 28);
  wire.circle(0, 1.15, 1.2, 0.45, "xz", "d", 28);
  wire.seg([0, 0.8, 1.2], [0, 1.05, 1.2], "w");

  const { group } = wire.build(mats);

  // rocking cradle + amber sample pin (big enough to read at room scale)
  const crW = new Wire();
  crW.circle(0, 0, 0, 0.55, "xy", "w", 24, Math.PI * 0.15, Math.PI * 0.85);
  crW.seg([0, 0.02, 0], [0, 0.5, 0], "d");
  crW.circle(0, 0.6, 0, 0.11, "xz", "amber", 12);
  crW.circle(0, 0.6, 0, 0.11, "xy", "amber", 12);
  crW.circle(0, 0.6, 0, 0.11, "yz", "amber", 12);
  const cradle = crW.build(mats).group;
  cradle.position.set(0, 0.55, 1.2);
  group.add(cradle);

  // area detector: panel + stand + beamstop; rings draw on separately
  const detW = new Wire();
  detW.poly([[-1.35, 0.15, 3.9], [1.35, 0.15, 3.9], [1.35, 2.15, 3.9], [-1.35, 2.15, 3.9]], "w");
  detW.box(-0.25, 0, 3.95, 0.5, 0.3, 0.4, "d");
  detW.circle(0, 1.15, 3.88, 0.07, "xy", "d", 10);
  group.add(detW.build(mats).group);
  const ringW = new Wire();
  for (const r of [0.28, 0.55, 0.82, 1.08]) ringW.circle(0, 1.15, 3.89, r, "xy", "amber", 40);
  const ringsB = ringW.build(mats, "rings");
  const ringLines = ringsB.lines.amber!;
  ringLines.geometry.setDrawRange(0, 0);
  group.add(ringsB.group);
  // faint diffraction cone from sample to the second ring
  const coneW = new Wire();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    coneW.seg([0, 1.15, 1.2], [Math.cos(a) * 0.55, 1.15 + Math.sin(a) * 0.55, 3.89], "d");
  }
  group.add(coneW.build(mats, "cone").group);

  // the X-ray pulse down the axis
  const beamW = new Wire();
  const BN = 14;
  for (let i = 0; i < BN; i++) {
    const z0 = -4.5 + (5.7 / BN) * i, z1 = -4.5 + (5.7 / BN) * (i + 1);
    beamW.seg([0, 1.15, z0], [0, 1.15, z1], "beam");
  }
  const beamB = beamW.build(mats, "beam");
  const beamLines = beamB.lines.beam!;
  beamLines.geometry.setDrawRange(0, 0);
  group.add(beamB.group);

  const TGT: P3 = [0, 1.15, 3.85];
  const def: StageDef = {
    group, mats, labels: [],
    kfs: [
      { p: 0, pos: [5.6, 3.8, -3.4], look: [0, 0.9, 0.4] },
      { p: 0.35, pos: [4.9, 2.7, 1.4], look: [0, 1.0, 1.2] },
      { p: 0.7, pos: [2.7, 2.0, 2.2], look: [0, 1.15, 2.9] },
      { p: 1, pos: [1.0, 1.55, 2.45], look: TGT },
    ],
    update: (f, t) => {
      cradle.rotation.z = 0.22 * Math.sin(t * 0.8);
      const u = (t * 0.8) % 1.4;
      beamLines.geometry.setDrawRange(0, Math.min(BN, Math.floor(u * BN * 1.5)) * 2);
      // the measurement: rings accumulate as you approach the detector
      const rr = smooth((f - 0.35) / 0.35);
      ringLines.geometry.setDrawRange(0, Math.floor(rr * 4 * 41) * 2);
      group.userData.fade = { cone: smooth((f - 0.45) / 0.15) * 0.7, rings: 1 };
    },
    target: TGT,
    reticleLbl: "THE RINGS",
    reticleFrom: 0.7,
  };
  def.labels = mkLabels(def, [
    { text: "SLITS", anchor: [-0.3, 1.8, -3.3], side: -1, alpha: f => smooth((f - 0.06) / 0.08) * (1 - smooth((f - 0.4) / 0.08)) },
    { text: "MONOCHROMATOR · SI(111)", anchor: [-0.7, 1.9, -2.3], side: -1, alpha: f => smooth((f - 0.12) / 0.08) * (1 - smooth((f - 0.5) / 0.08)) },
    { text: "GONIOMETER", anchor: [0.75, 1.5, 1.2], side: 1, alpha: f => smooth((f - 0.3) / 0.08) * (1 - smooth((f - 0.66) / 0.08)) },
    { text: "DEBYE-SCHERRER RINGS", anchor: [0.9, 2.0, 3.9], amber: true, side: 1, alpha: f => smooth((f - 0.55) / 0.1) * (1 - smooth((f - 0.85) / 0.08)) },
  ]);
  return def;
}

// ==================================================================== S16
// ALL IN ONE: the reveal. A browser window growing a dendrite, with every
// machine from the ladder orbiting it. The instrument is SOLIDIFY.
function buildAllInOne(): StageDef {
  const mats: Mat[] = [];
  const wire = new Wire();

  // ground ring
  wire.circle(0, 0, 0, 4.9, "xz", "d", 72);

  // the browser window: frame, top bar, dots, stand
  wire.poly([[-1.9, 1.1, 0], [1.9, 1.1, 0], [1.9, 3.7, 0], [-1.9, 3.7, 0]], "w");
  wire.poly([[-1.82, 1.18, 0], [1.82, 1.18, 0], [1.82, 3.38, 0], [-1.82, 3.38, 0]], "d");
  wire.seg([-1.9, 3.42, 0], [1.9, 3.42, 0], "w");
  for (let k = 0; k < 3; k++) wire.circle(-1.68 + k * 0.18, 3.56, 0.01, 0.05, "xy", "d", 8);
  wire.seg([-0.5, 1.1, 0], [-0.7, 0.55, 0], "w");
  wire.seg([0.5, 1.1, 0], [0.7, 0.55, 0], "w");
  wire.circle(0, 0.55, 0, 1.0, "xz", "d", 32);
  // screen content: a mini six-fold dendrite + lens rail + sparkline
  for (let arm = 0; arm < 6; arm++) {
    const th = (arm / 6) * Math.PI * 2 + 0.26;
    const cx = 0, cy = 2.32;
    const tipX = cx + Math.cos(th) * 0.85, tipY = cy + Math.sin(th) * 0.85;
    wire.seg([cx, cy, 0.01], [tipX, tipY, 0.01], "amber");
    wire.seg([lerp(cx, tipX, 0.55) - Math.sin(th) * 0.16, lerp(cy, tipY, 0.55) + Math.cos(th) * 0.16, 0.01], [lerp(cx, tipX, 0.55), lerp(cy, tipY, 0.55), 0.01], "amber");
    wire.seg([lerp(cx, tipX, 0.55) + Math.sin(th) * 0.16, lerp(cy, tipY, 0.55) - Math.cos(th) * 0.16, 0.01], [lerp(cx, tipX, 0.55), lerp(cy, tipY, 0.55), 0.01], "amber");
  }
  for (let k = 0; k < 10; k++) wire.seg([-1.6 + k * 0.34, 1.28, 0.01], [-1.45 + k * 0.34, 1.28, 0.01], k === 0 ? "amber" : "d");
  wire.poly([[1.0, 3.05, 0.01], [1.2, 3.2, 0.01], [1.35, 3.0, 0.01], [1.55, 3.25, 0.01], [1.7, 3.12, 0.01]], "d", false);

  const { group } = wire.build(mats);

  // the carousel: every machine from the dive, miniaturized, orbiting
  const carousel = new Group();
  group.add(carousel);
  const minis: ((w: Wire) => void)[] = [
    w => { // gpu card
      w.box(-0.5, 0, -0.22, 1.0, 0.05, 0.44, "w");
      w.circle(-0.22, 0.06, 0, 0.16, "xz", "d", 12);
      w.circle(0.18, 0.06, 0, 0.16, "xz", "d", 12);
    },
    w => { // arc melter chamber
      w.cyl(0, 0, 0, 0.26, 0.4, "w", 4, 12);
      w.seg([0.2, 0.75, 0], [0, 0.42, 0], "d");
    },
    w => { // polisher wheel
      w.box(-0.3, 0, -0.25, 0.6, 0.25, 0.5, "w");
      w.circle(0, 0.27, 0, 0.24, "xz", "d", 14);
    },
    w => { // sem column
      w.circle(0, 0.55, 0, 0.12, "xz", "w", 10);
      w.circle(0, 0.38, 0, 0.16, "xz", "w", 12);
      w.circle(0, 0.2, 0, 0.2, "xz", "w", 12);
      w.box(-0.2, 0, -0.2, 0.4, 0.12, 0.4, "d");
    },
    w => { // tensile frame
      w.seg([-0.2, 0, 0], [-0.2, 0.6, 0], "w");
      w.seg([0.2, 0, 0], [0.2, 0.6, 0], "w");
      w.seg([-0.25, 0.6, 0], [0.25, 0.6, 0], "w");
      w.seg([-0.25, 0.32, 0], [0.25, 0.32, 0], "d");
      w.seg([0, 0.12, 0], [0, 0.32, 0], "amber");
    },
    w => { // synchrotron ring
      w.circle(0, 0.1, 0, 0.3, "xz", "w", 20);
      w.seg([0.3, 0.1, 0], [0.55, 0.1, 0.3], "d");
    },
    w => { // beamline detector + rings
      w.poly([[-0.22, 0, 0], [0.22, 0, 0], [0.22, 0.5, 0], [-0.22, 0.5, 0]], "w");
      w.circle(0, 0.25, 0.01, 0.08, "xy", "amber", 8);
      w.circle(0, 0.25, 0.01, 0.15, "xy", "d", 10);
    },
  ];
  minis.forEach((draw, k) => {
    const w = new Wire();
    draw(w);
    const b = w.build(mats, `m${k}`);
    const a = (k / minis.length) * Math.PI * 2;
    b.group.position.set(Math.cos(a) * 4.1, 0.35, Math.sin(a) * 4.1);
    b.group.rotation.y = -a + Math.PI / 2;
    carousel.add(b.group);
    const tw = new Wire();
    tw.seg([Math.cos(a) * 3.6, 0.02, Math.sin(a) * 3.6], [Math.cos(a) * 2.2, 0.02, Math.sin(a) * 2.2], "d");
    const tb = tw.build(mats, `m${k}`);
    carousel.add(tb.group);
  });

  const def: StageDef = {
    group, mats, labels: [],
    cam: (f, pos, look) => {
      // orbit in and settle dead-on: the window faces +z, so end at az = π/2
      const az = 0.75 + smooth(f) * (Math.PI / 2 - 0.75);
      const r = 10.8 - smooth(f) * 3.4;
      const y = 4.8 - smooth(f) * 2.3;
      pos.set(Math.cos(az) * r, y, Math.sin(az) * r);
      look.set(0, 1.9, 0);
    },
    update: (f, t) => {
      carousel.rotation.y = t * 0.12;
      const fade: Record<string, number> = {};
      for (let k = 0; k < minis.length; k++) fade[`m${k}`] = smooth((f - 0.12 - k * 0.05) / 0.08);
      group.userData.fade = fade;
    },
  };
  def.labels = mkLabels(def, [
    { text: "LIVE PHASE-FIELD SOLVER", anchor: [0, 4.0, 0], amber: true, side: 1, alpha: f => smooth((f - 0.3) / 0.1) },
    { text: "10 RENDER LENSES", anchor: [-1.75, 1.28, 0], side: -1, alpha: f => smooth((f - 0.45) / 0.1) },
    { text: "RUNS ON THE CARD FROM STAGE 01", anchor: [2.2, 0.4, 2.2], side: 1, alpha: f => smooth((f - 0.6) / 0.1) },
  ]);
  return def;
}

// ==================================================================== S6
// the polisher: spinning platen, slurry, the puck face going to a mirror.
function buildPolisher(): StageDef {
  const mats: Mat[] = [];
  const wire = new Wire();

  // cabinet with controls
  wire.box(-3.5, 0, -2.5, 7, 2.1, 5, "w");
  wire.circle(-2.2, 1.1, 2.51, 0.28, "xy", "d", 14);
  wire.circle(-1.3, 1.1, 2.51, 0.28, "xy", "d", 14);
  wire.box(-0.5, 0.95, 2.5, 0.5, 0.3, 0.05, "d");
  // bowl rim + drain
  wire.circle(0.4, 2.3, -0.1, 2.6, "xz", "w", 48);
  wire.circle(0.4, 2.1, -0.1, 2.45, "xz", "d", 48);
  // specimen holder: post + arm + head over the platen
  wire.box(2.9, 2.1, -1.9, 0.5, 1.7, 0.5, "w");
  wire.poly([[3.15, 3.6, -1.65], [1.4, 3.4, -0.3], [1.15, 3.15, -0.15]], "w", false);
  wire.cyl(1.05, 2.5, 0.35, 0.5, 0.55, "w", 6);
  // slurry stand + drip line
  wire.box(-2.4, 2.3, -1.9, 0.35, 1.2, 0.35, "d");
  wire.cyl(-2.22, 3.5, -1.72, 0.16, 0.5, "d", 0, 10);
  wire.poly([[-2.22, 3.5, -1.72], [-1.6, 3.0, -1.0], [-0.9, 2.6, -0.5]], "d", false);

  const { group } = wire.build(mats);

  // spinning platen with sheen rings and hair lines
  const platenW = new Wire();
  platenW.circle(0, 0, 0, 2.25, "xz", "w", 48);
  for (const r of [0.7, 1.2, 1.7]) platenW.circle(0, 0.01, 0, r, "xz", "d", 40);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    platenW.seg([Math.cos(a) * 0.3, 0.02, Math.sin(a) * 0.3], [Math.cos(a) * 2.1, 0.02, Math.sin(a) * 2.1], "d");
  }
  const platen = platenW.build(mats).group;
  platen.position.set(0.4, 2.32, -0.1);
  group.add(platen);
  // the puck in the holder: amber mirror face just above the platen
  const puckW = new Wire();
  puckW.cyl(0, 0, 0, 0.34, 0.3, "amber", 0, 24);
  const puck = puckW.build(mats).group;
  puck.position.set(1.05, 2.36, 0.35);
  group.add(puck);

  const TGT: P3 = [1.05, 2.5, 0.35];
  const def: StageDef = {
    group, mats, labels: [],
    kfs: [
      { p: 0, pos: [8.8, 6.2, 8.4], look: [0.2, 1.8, 0] },
      { p: 0.4, pos: [5.9, 4.7, 4.9], look: [0.4, 2.2, -0.1] },
      { p: 0.75, pos: [3.1, 3.7, 2.6], look: TGT },
      { p: 1, pos: [1.7, 3.0, 1.15], look: TGT },
    ],
    update: (f, t) => {
      void f;
      platen.rotation.y = t * 2.4;
      puck.rotation.y = -t * 1.1;
    },
    target: TGT,
    reticleLbl: "THE MIRROR FACE",
    reticleFrom: 0.6,
  };
  def.labels = mkLabels(def, [
    { text: "250 RPM PLATEN", anchor: [-1.6, 2.5, -0.8], side: -1 },
    { text: "1 µM DIAMOND SLURRY", anchor: [-2.22, 3.9, -1.72], side: -1 },
    { text: "HOLDER · COUNTER-ROTATING", anchor: [3.0, 3.7, -1.7], side: 1 },
    { text: "THE MIRROR FACE", anchor: [1.05, 2.75, 0.35], amber: true, side: 1, alpha: f => smooth((f - 0.32) / 0.1) * (1 - smooth((f - 0.56) / 0.08)) },
  ]);
  return def;
}

// ==================================================================== S10
// the light source: a synchrotron from the air. Electron bunches race the
// storage ring; the beamline fires X-ray pulses into the hutch where the
// sample sits. This machine is how anyone knows an atom's address.
function buildSynchrotron(): StageDef {
  const mats: Mat[] = [];
  const wire = new Wire();

  // a box rotated about Y — for ring magnets sitting tangent to the circle
  const rotBox = (cx: number, cz: number, ang: number, l: number, w: number, y0: number, h: number, cls: Cls) => {
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const c = (dx: number, dz: number): [number, number] => [cx + dx * ca - dz * sa, cz + dx * sa + dz * ca];
    const pts = [c(-l / 2, -w / 2), c(l / 2, -w / 2), c(l / 2, w / 2), c(-l / 2, w / 2)];
    const bot: P3[] = pts.map(p => [p[0], y0, p[1]] as const);
    const top: P3[] = pts.map(p => [p[0], y0 + h, p[1]] as const);
    wire.poly(bot, cls);
    wire.poly(top, cls);
    for (let i = 0; i < 4; i++) wire.seg(bot[i], top[i], cls);
  };

  // storage ring + inner booster + linac
  wire.circle(0, 0.32, 0, 4.2, "xz", "w", 72);
  wire.circle(0, 0.32, 0, 3.9, "xz", "d", 72);
  wire.circle(0, 0.12, 0, 2.1, "xz", "d", 48);
  wire.poly([[-0.4, 0.12, -0.35], [-1.45, 0.12, -1.5]], "d", false);
  wire.box(-0.62, 0.02, -0.58, 0.45, 0.3, 0.45, "d");
  // bending magnets every 30°, tangent to the ring
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2 + 0.13;
    rotBox(Math.cos(a) * 4.05, Math.sin(a) * 4.05, a + Math.PI / 2, 0.95, 0.5, 0.06, 0.5, "d");
  }
  // RF cavities: two cylinders on the far side
  wire.cyl(-3.55, 0.06, -2.05, 0.28, 0.55, "w", 6, 16);
  wire.cyl(-3.15, 0.06, -2.6, 0.28, 0.55, "w", 6, 16);
  // undulator on the straight section before the beamline exit
  rotBox(4.05, -1.1, Math.PI / 2, 1.5, 0.55, 0.06, 0.45, "w");
  for (let k = 0; k < 7; k++) wire.seg([3.8, 0.56, -1.75 + k * 0.22], [4.3, 0.56, -1.75 + k * 0.22], "d");

  // beamline: twin pipes from the undulator to the hutches (+z direction)
  wire.seg([4.0, 0.32, -0.2], [4.0, 0.32, 4.6], "d");
  wire.seg([4.4, 0.32, -0.2], [4.4, 0.32, 4.6], "d");
  // optics hutch + experimental hutch
  wire.box(3.6, 0, 1.4, 1.2, 0.75, 0.9, "w");
  wire.box(3.45, 0, 3.6, 1.5, 0.95, 1.5, "w");
  // sample stage + area detector panel inside the experimental hutch
  wire.box(4.05, 0.02, 4.15, 0.3, 0.42, 0.3, "d");
  wire.poly([[3.6, 0.15, 4.9], [4.7, 0.15, 4.9], [4.7, 0.85, 4.9], [3.6, 0.85, 4.9]], "w");
  for (let k = 1; k < 4; k++) wire.seg([3.6, 0.15 + k * 0.175, 4.9], [4.7, 0.15 + k * 0.175, 4.9], "d");
  // the sample: tiny amber puck on the stage
  wire.cyl(4.2, 0.44, 4.3, 0.12, 0.08, "amber", 0, 14);

  const { group } = wire.build(mats);

  // X-ray pulse: drawRange flashes down the beamline to the sample
  const beamW = new Wire();
  const BN = 16;
  for (let i = 0; i < BN; i++) {
    const z0 = -0.2 + (4.5 / BN) * i, z1 = -0.2 + (4.5 / BN) * (i + 1);
    beamW.seg([4.2, 0.4, z0], [4.2, 0.4, z1], "beam");
  }
  const beamB = beamW.build(mats, "beam");
  const beamLines = beamB.lines.beam!;
  beamLines.geometry.setDrawRange(0, 0);
  group.add(beamB.group);

  // electron bunches racing the ring
  const bg = new BufferGeometry();
  bg.setAttribute("position", new Float32BufferAttribute(new Array(6 * 3).fill(0), 3));
  const bm = new PointsMaterial({ color: 0xf59e0b, size: 0.14, transparent: true, opacity: 0.95, depthWrite: false });
  mats.push({ m: bm as unknown as LineBasicMaterial, base: 0.95, tag: "" });
  const bunches = new Points(bg, bm);
  group.add(bunches);

  const TGT: P3 = [4.2, 0.5, 4.3];
  const def: StageDef = {
    group, mats, labels: [],
    kfs: [
      { p: 0, pos: [2.5, 11.5, 9.0], look: [0, 0, 0.6] },
      { p: 0.35, pos: [7.8, 6.0, 6.6], look: [1.8, 0, 1.6] },
      { p: 0.7, pos: [6.6, 2.4, 5.9], look: [4.1, 0.4, 3.4] },
      { p: 1, pos: [4.95, 1.1, 4.95], look: TGT },
    ],
    update: (f, t) => {
      void f;
      const p = bunches.geometry.getAttribute("position");
      for (let i = 0; i < 6; i++) {
        const a = t * 1.4 + (i / 6) * Math.PI * 2;
        p.setXYZ(i, Math.cos(a) * 4.05, 0.36, Math.sin(a) * 4.05);
      }
      p.needsUpdate = true;
      // pulse: sawtooth draw down the line, brief hold, reset
      const u = (t * 0.7) % 1.3;
      beamLines.geometry.setDrawRange(0, Math.min(BN, Math.floor(u * BN * 1.4)) * 2);
    },
    target: TGT,
    reticleLbl: "THE HUTCH",
    reticleFrom: 0.62,
  };
  def.labels = mkLabels(def, [
    { text: "STORAGE RING · 3 GEV", anchor: [-3.0, 0.7, 2.9], side: -1 },
    { text: "RF CAVITIES", anchor: [-3.5, 0.8, -2.3], side: -1 },
    { text: "UNDULATOR", anchor: [4.15, 0.7, -1.1], side: 1 },
    { text: "AREA DETECTOR", anchor: [4.15, 1.0, 4.9], side: 1, alpha: f => smooth((f - 0.55) / 0.1) * (1 - smooth((f - 0.85) / 0.08)) },
    { text: "THE SAMPLE · DIVE TARGET", anchor: [4.2, 0.62, 4.3], amber: true, side: -1, alpha: f => smooth((f - 0.5) / 0.1) * (1 - smooth((f - 0.6) / 0.08)) },
  ]);
  return def;
}

// ==================================================================== S11
// the finale: hexagonal close packing, atom by atom. The six-fold answer.
function buildLattice(): StageDef {
  const mats: Mat[] = [];
  const A = 1.0, CY = 0.816 * A * 2; // hcp: c/2 spacing per layer pair

  interface Prim { key: number; draw: (w: Wire) => void }
  const prims: Prim[] = [];
  const atoms: { x: number; y: number; z: number; layer: number }[] = [];
  const hexPts: [number, number][] = [];
  for (let q = -3; q <= 3; q++) for (let r = -3; r <= 3; r++) {
    const x = A * (q + r / 2), z = A * r * 0.866;
    if (Math.hypot(x, z) < 2.65) hexPts.push([x, z]);
  }
  for (const [x, z] of hexPts) {
    atoms.push({ x, y: 0, z, layer: 0 });
    atoms.push({ x, y: CY, z, layer: 2 });
    const bx = x + A / 2, bz = z + A * 0.289;
    if (Math.hypot(bx, bz) < 2.5) atoms.push({ x: bx, y: CY / 2, z: bz, layer: 1 });
  }
  for (const at of atoms) {
    const key = Math.hypot(at.x, at.z) + at.y * 0.45;
    const cls: Cls = at.layer === 1 ? "w" : "d";
    prims.push({
      key,
      draw: w => {
        w.circle(at.x, at.y, at.z, 0.17, "xz", cls, 14);
        w.circle(at.x, at.y, at.z, 0.17, "xy", cls, 14);
        w.circle(at.x, at.y, at.z, 0.17, "yz", cls, 14);
      },
    });
    // bonds down to the three atoms below (central region only)
    if (at.layer === 1 && Math.hypot(at.x, at.z) < 1.6) {
      for (const nb of atoms) {
        if (nb.layer !== 0) continue;
        const d = Math.hypot(at.x - nb.x, at.z - nb.z);
        if (d < A * 0.62) prims.push({ key: key + 0.2, draw: w => w.seg([at.x, at.y, at.z], [nb.x, nb.y, nb.z], "d") });
      }
    }
  }
  // in-plane bonds for the base layer, central region
  for (const a1 of atoms) {
    if (a1.layer !== 0 || Math.hypot(a1.x, a1.z) > 1.9) continue;
    for (const a2 of atoms) {
      if (a2.layer !== 0 || a2 === a1) continue;
      const d = Math.hypot(a1.x - a2.x, a1.z - a2.z);
      if (d > A * 0.9 && d < A * 1.1 && a1.x + a1.z * 3 < a2.x + a2.z * 3)
        prims.push({ key: Math.hypot(a1.x, a1.z) + 0.1, draw: w => w.seg([a1.x, 0, a1.z], [a2.x, 0, a2.z], "d") });
    }
  }
  // the amber unit cell: hexagonal prism around the center atom
  for (let k = 0; k < 6; k++) {
    const a0 = (k / 6) * Math.PI * 2, a1 = ((k + 1) / 6) * Math.PI * 2;
    const p0: [number, number] = [Math.cos(a0) * A, Math.sin(a0) * A];
    const p1: [number, number] = [Math.cos(a1) * A, Math.sin(a1) * A];
    prims.push({
      key: 0.01,
      draw: w => {
        w.seg([p0[0], 0, p0[1]], [p1[0], 0, p1[1]], "amber");
        w.seg([p0[0], CY, p0[1]], [p1[0], CY, p1[1]], "amber");
        w.seg([p0[0], 0, p0[1]], [p0[0], CY, p0[1]], "amber");
      },
    });
  }

  // emit in birth order, recording per-class birth arrays for drawRange
  prims.sort((p1, p2) => p1.key - p2.key);
  const maxKey = prims[prims.length - 1].key;
  const wire = new Wire();
  const counts: Record<Cls, number> = { w: 0, d: 0, amber: 0, beam: 0 };
  const births: Record<Cls, number[]> = { w: [], d: [], amber: [], beam: [] };
  for (const pr of prims) {
    pr.draw(wire);
    (Object.keys(counts) as Cls[]).forEach(cls => {
      const now = wire.v[cls].length / 6;
      for (let k = counts[cls]; k < now; k++) births[cls].push(pr.key / maxKey);
      counts[cls] = now;
    });
  }
  const built = wire.build(mats);
  const group = built.group;
  for (const cls of ["w", "d", "amber"] as const) built.lines[cls]?.geometry.setDrawRange(0, 0);

  const def: StageDef = {
    group, mats, labels: [],
    cam: (f, pos, look) => {
      const az = 0.8 - f * 0.55;
      const r = 9.8 - smooth(f) * 3.0;
      const y = 4.9 - smooth(f) * 1.6;
      pos.set(Math.cos(az) * r, y, Math.sin(az) * r);
      look.set(0, 0.7, 0);
    },
    update: (f, t) => {
      group.rotation.y = t * 0.06;
      const g = smooth((f - 0.04) / 0.72);
      for (const cls of ["w", "d", "amber"] as const) {
        const ls = built.lines[cls];
        if (ls) ls.geometry.setDrawRange(0, upperBound(births[cls], g) * 2);
      }
    },
  };
  def.labels = mkLabels(def, [
    { text: "CLOSE-PACKED PLANES · ABAB", anchor: [2.0, CY, 0.6], side: 1, alpha: f => smooth((f - 0.4) / 0.1) },
    { text: "a ≈ 0.32 NM", anchor: [-2.2, 0, 1.2], side: -1, alpha: f => smooth((f - 0.55) / 0.1) },
    { text: "SIX-FOLD BECAUSE THE LATTICE IS", anchor: [0, CY + 0.5, -1.9], amber: true, side: 1, alpha: f => smooth((f - 0.68) / 0.12) },
  ]);
  return def;
}

// ==================================================================== S7
// the SEM column — assembled, then EXPLODED apart with labeled callouts
// (the anime.js lens moment), the beam drawn through the bores, and the
// camera diving into the chamber. Spins slowly about its own axis.
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

  // electron gun + HV feedthrough stack
  addPart(w => {
    w.cyl(0, 0, 0, 0.75, 1.1, "w", 8);
    w.circle(0, 1.1, 0, 0.45, "xz", "d");
    w.seg([-0.28, 0.55, 0], [0, 0.12, 0], "w");
    w.seg([0.28, 0.55, 0], [0, 0.12, 0], "w");
    w.circle(0, 0, 0, 0.3, "xz", "d");
    // insulator rings + terminal knob on top
    w.circle(0, 1.32, 0, 0.34, "xz", "d", 20);
    w.circle(0, 1.48, 0, 0.28, "xz", "d", 20);
    w.circle(0, 1.64, 0, 0.22, "xz", "d", 20);
    w.cyl(0, 1.72, 0, 0.12, 0.22, "w", 0, 12);
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
  // objective lens + stigmator ring + aperture + BSE detector ring
  addPart(w => {
    w.cyl(0, -0.42, 0, 1.5, 0.84, "w", 0, 44);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      w.seg([Math.cos(a) * 1.5, -0.42, Math.sin(a) * 1.5], [Math.cos(a) * 1.5, 0.42, Math.sin(a) * 1.5], "d");
    }
    // stigmator: eight pole circles just above the body
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      w.circle(Math.cos(a) * 1.12, 0.5, Math.sin(a) * 1.12, 0.09, "xz", "d", 8);
    }
    // conic pole piece down to the bore
    w.circle(0, -0.42, 0, 1.0, "xz", "d");
    w.circle(0, -0.75, 0, 0.35, "xz", "w");
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      w.seg([Math.cos(a) * 1.0, -0.42, Math.sin(a) * 1.0], [Math.cos(a) * 0.35, -0.75, Math.sin(a) * 0.35], "d");
    }
    w.box(-0.65, -0.95, -0.14, 1.3, 0.1, 0.28, "d");
    // BSE detector ring under the pole piece
    w.circle(0, -1.02, 0, 0.55, "xz", "d", 24);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      w.seg([Math.cos(a) * 0.38, -1.02, Math.sin(a) * 0.38], [Math.cos(a) * 0.55, -1.02, Math.sin(a) * 0.55], "d");
    }
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
    // door hatch lines + porthole + hinge on the front wall
    w.seg([-1.2, 0.3, s], [1.2, 0.3, s], "d");
    w.seg([-1.2, 1.7, s], [1.2, 1.7, s], "d");
    w.seg([-1.2, 0.3, s], [-1.2, 1.7, s], "d");
    w.seg([1.2, 0.3, s], [1.2, 1.7, s], "d");
    w.circle(0.55, 1.05, s + 0.01, 0.34, "xy", "d", 20);
    w.seg([-1.32, 0.5, s], [-1.32, 1.5, s], "w");
    // SE detector cone + EDS snout poking in
    w.poly([[1.9, 1.35, 0.9], [2.2, 1.5, 1.3], [2.2, 1.2, 1.3]], "w");
    w.poly([[-1.7, 1.4, -0.5], [-2.3, 1.6, -0.9], [-2.3, 1.3, -0.9], [-1.7, 1.15, -0.5]], "d");
    // turbo pump hanging under the floor
    w.cyl(-1.3, -0.85, -1.2, 0.5, 0.85, "d", 6, 18);
    w.circle(-1.3, -0.45, -1.2, 0.62, "xz", "d", 18);
  }, 0, -0.8);
  // outer casing (+ ISO flange rings, cable conduit): fades as the explode begins
  addPart(w => {
    w.cyl(0, 0, 0, 1.85, 6.3, "w", 8);
    w.circle(0, 2.1, 0, 1.85, "xz", "d");
    w.circle(0, 4.2, 0, 1.85, "xz", "d");
    w.circle(0, -0.25, 0, 2.1, "xz", "d");
    w.circle(0, 6.15, 0, 2.0, "xz", "d", 40);
    // cable conduit running down the outside
    w.poly([[1.0, 6.3, 1.55], [1.75, 5.9, 1.0], [1.9, 4.4, 0.6], [1.9, 2.2, 0.6], [1.75, 0.4, 0.9]], "d", false);
    w.poly([[1.15, 6.3, 1.4], [1.9, 5.9, 0.85], [2.05, 4.4, 0.45], [2.05, 2.2, 0.45]], "d", false);
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
      // the whole column turns slowly about its own axis while it explodes
      root.rotation.y = t * 0.12;
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

  // rim, bottom, polishing arcs, mount clips, a hardness indent
  wire.circle(0, 0, 0, RAD, "xz", "w", 64);
  wire.circle(0, -0.9, 0, RAD, "xz", "d", 64);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    wire.seg([Math.cos(a) * RAD, 0, Math.sin(a) * RAD], [Math.cos(a) * RAD, -0.9, Math.sin(a) * RAD], "d");
  }
  for (const [r, a0, a1] of [[2.1, 0.4, 1.6], [3.2, 3.4, 4.3], [1.4, 4.9, 5.8]] as const)
    wire.circle(0, 0.015, 0, r, "xz", "d", 30, a0, a1);
  // spring clips holding the puck to the stage stub
  for (const ca of [1.15, 4.35]) {
    const dx = Math.cos(ca), dz = Math.sin(ca);
    wire.poly([
      [dx * (RAD + 0.5), -0.4, dz * (RAD + 0.5)],
      [dx * (RAD + 0.15), 0.25, dz * (RAD + 0.15)],
      [dx * (RAD - 0.5), 0.09, dz * (RAD - 0.5)],
      [dx * (RAD - 0.75), 0.02, dz * (RAD - 0.75)],
    ], "w", false);
  }
  // Vickers indent: a tiny diamond with its diagonals
  {
    const ix = -2.15, iz = -0.55, s = 0.16;
    wire.poly([[ix - s, 0.012, iz], [ix, 0.012, iz - s], [ix + s, 0.012, iz], [ix, 0.012, iz + s]], "w");
    wire.seg([ix - s, 0.012, iz], [ix + s, 0.012, iz], "d");
    wire.seg([ix, 0.012, iz - s], [ix, 0.012, iz + s], "d");
  }

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

  // instrument dressing: field ring + corner ticks + thermal halos at the tips
  const dress = new Wire();
  dress.circle(0, 0, 0, 4.9, "xz", "d", 72);
  for (const a of [0.5, 2.07, 3.64, 5.21]) {
    dress.seg([Math.cos(a) * 4.9, 0, Math.sin(a) * 4.9], [Math.cos(a) * 5.25, 0, Math.sin(a) * 5.25], "d");
  }
  for (let arm = 0; arm < 6; arm++) {
    const th = (arm / 6) * Math.PI * 2 + 0.13;
    const tx = Math.cos(th) * 4.2, tz = Math.sin(th) * 4.2;
    dress.circle(tx, 0, tz, 0.55, "xz", "d", 20, th - 1.2, th + 1.2);
  }
  group.add(dress.build(mats).group);

  const def: StageDef = {
    group, mats, labels: [],
    cam: (f, pos, look) => {
      // grow wide, then dive into the nucleus for the cut to the light source
      const az = 0.95 - f * 0.62;
      const g = smooth(f);
      const dive = smooth((f - 0.8) / 0.2);
      const r = (10.6 + g * 2.9) * (1 - dive * 0.85);
      const y = (5.2 + g * 0.7) * (1 - dive * 0.78);
      pos.set(Math.cos(az) * r, y, Math.sin(az) * r);
      look.set(0, 0.1 * (1 - dive), 0);
    },
    update: (f) => {
      const g = smooth((f - 0.03) / 0.72);
      for (const cls of ["w", "d", "amber"] as const) {
        const e = byCls[cls];
        if (!e) continue;
        e.lines.geometry.setDrawRange(0, upperBound(e.births, g) * 2);
      }
    },
    target: [0, 0, 0],
    reticleLbl: "THE NUCLEUS",
    reticleFrom: 0.72,
  };
  def.labels = mkLabels(def, [
    { text: "PRIMARY ARM", anchor: [3.1, 0.15, 1.4], side: 1, alpha: f => smooth((f - 0.42) / 0.1) * (1 - smooth((f - 0.78) / 0.1)) },
    { text: "SECONDARY ARMS · λ₂", anchor: [-2.0, 0.15, 2.3], side: -1, alpha: f => smooth((f - 0.55) / 0.1) * (1 - smooth((f - 0.78) / 0.1)) },
    { text: "LATENT HEAT LIVES AT THE TIPS", anchor: [0, 0.2, -3.6], side: 1, alpha: f => smooth((f - 0.66) / 0.1) * (1 - smooth((f - 0.85) / 0.08)) },
  ]);
  return def;
}

// --------------------------------------------------------------- helpers
function mkLabels(def: StageDef, list: LabelDef[]): { def: LabelDef; el: HTMLElement }[] {
  void def;
  return list.map(d => ({ def: d, el: undefined as unknown as HTMLElement }));
}
