// The dive: an Exea-style scroll descent through five stages of scale —
// GPU card → die → microscope → specimen → the live simulation. 2.5D camera:
// each stage is a full-viewport plane; the camera zooms toward the stage's
// dashed reticle (the dive target), panning it to center, and the next stage
// crossfades in exactly inside the reticle. Piecewise zoom (rebased per
// stage) keeps CSS transform scales small. Stage art lives in index.html as
// stroke-only SVGs; Frank's hand-drawn vectors can replace any stage
// file-for-file (see docs/dive-art-spec.md).

import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

const VBW = 1200, VBH = 800;   // every stage SVG shares this viewBox

interface StageMeta {
  field: string;   // HUD scale readout
  title: string;
  sub: string;
}

const META: StageMeta[] = [
  { field: "FIELD ≈ 300 MM", title: "YOUR GPU", sub: "The furnace. A million cells solve the freeze on this card, sixty times a second." },
  { field: "FIELD ≈ 40 MM", title: "THE DIE", sub: "The field lives in VRAM: φ, T, c, age — 128 bits per cell, two compute passes per step." },
  { field: "FIELD ≈ 5 MM", title: "THE MICROSCOPE", sub: "An electron column, taken apart. Gun, condensers, scan coils, objective: the optics that see metal at the micron." },
  { field: "FIELD ≈ 500 µM", title: "THE SPECIMEN", sub: "Grains, boundaries, dendrite arms: the structure that decides whether metal holds." },
  { field: "FIELD ≈ 50 µM", title: "THE DENDRITE", sub: "Anisotropy chooses the arms. Latent heat spaces them. The lab grows the real thing live in your browser." },
];

const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

export function initDive(reduced: boolean) {
  const act = document.getElementById("diveAct");
  if (!act) return;
  const els = [...act.querySelectorAll<HTMLElement>(".stage")];
  if (els.length !== META.length) return;
  const ks = els.map(el => parseFloat(el.dataset.k ?? "8"));
  const anchors = els.map(el => ({
    x: parseFloat(el.dataset.ax ?? "600"),
    y: parseFloat(el.dataset.ay ?? "400"),
  }));
  const logKs = ks.map(k => Math.log(k));
  const totalLog = logKs.reduce((a, b) => a + b, 0);

  const fieldEl = document.getElementById("diveField")!;
  const numEl = document.getElementById("diveNum")!;
  const titleEl = document.getElementById("diveTitle")!;
  const subEl = document.getElementById("diveSub")!;
  const dashEls = [...document.querySelectorAll<HTMLElement>("#diveDashes i")];

  // cover-fit mapping: SVG content coords -> viewport px (matches slice)
  const toScreen = (cx: number, cy: number) => {
    const vw = innerWidth, vh = innerHeight;
    const sc = Math.max(vw / VBW, vh / VBH);
    return { x: cx * sc + (vw - VBW * sc) / 2, y: cy * sc + (vh - VBH * sc) / 2 };
  };

  let curStage = -1;
  const setHud = (i: number) => {
    if (i === curStage) return;
    curStage = i;
    const m = META[i];
    fieldEl.textContent = m.field;
    numEl.textContent = `0${i + 1} / 05`;
    titleEl.textContent = m.title;
    subEl.textContent = m.sub;
    dashEls.forEach((d, j) => d.classList.toggle("on", j <= i));
    gsap.fromTo([titleEl, subEl], { y: 10, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, stagger: 0.05, ease: "power2.out", overwrite: true });
  };

  const apply = (p: number) => {
    let L = p * totalLog;
    let i = 0;
    while (i < els.length - 1 && L > logKs[i]) { L -= logKs[i]; i++; }
    const s = Math.exp(Math.min(L, logKs[i]));
    const f = Math.min(1, L / logKs[i]);
    const vw = innerWidth, vh = innerHeight;

    els.forEach((el, j) => { el.style.display = j === i || j === i + 1 ? "block" : "none"; });

    // current plane: zoom toward its reticle while panning the reticle to center
    const a = toScreen(anchors[i].x, anchors[i].y);
    const panX = (vw / 2 - a.x) * f;
    const panY = (vh / 2 - a.y) * f;
    const cur = els[i];
    cur.style.transformOrigin = `${a.x}px ${a.y}px`;
    cur.style.transform = `translate(${panX}px, ${panY}px) scale(${s})`;
    const isLast = i === els.length - 1;
    cur.style.opacity = String(isLast ? 1 : 1 - smooth((f - 0.8) / 0.2));

    // next plane rides inside the reticle, fading in as the camera closes
    if (!isLast) {
      const ch = els[i + 1];
      ch.style.transformOrigin = "50% 50%";
      ch.style.transform = `translate(${a.x + panX - vw / 2}px, ${a.y + panY - vh / 2}px) scale(${s / ks[i]})`;
      ch.style.opacity = String(smooth((f - 0.45) / 0.4));
    }
    setHud(f > 0.82 && !isLast ? i + 1 : i);
  };

  if (reduced) { apply(0); setHud(0); return; }

  ScrollTrigger.create({
    id: "dive",
    trigger: act,
    start: "top top",
    end: "+=5200",
    pin: true,
    scrub: true,
    onUpdate: self => apply(self.progress),
  });
  addEventListener("resize", () => apply(ScrollTrigger.getById("dive")?.progress ?? 0), { passive: true });
  apply(0);
  setHud(0);
}
