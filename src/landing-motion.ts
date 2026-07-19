// Landing motion layer, driven by anime.js v4. Everything here is decorative:
// the inline <head> gate only adds html.anim when motion is allowed, and a
// watchdog reveals the page if this module never runs. All tweens are
// transform/opacity/filter only, so the WebGPU demo never fights for layout.

import { animate, createTimeline, stagger, utils } from "animejs";

declare global { interface Window { __landingMotion?: boolean } }

const root = document.documentElement;

function splitLetters(h1: HTMLElement) {
  // rebuild "SOLID<span>IFY</span>" as per-letter spans, preserving the amber
  // span; screen readers keep the intact label
  h1.setAttribute("aria-label", h1.textContent ?? "SOLIDIFY");
  const frag = document.createDocumentFragment();
  const wrap = (ch: string, amber: boolean) => {
    const s = document.createElement("span");
    s.className = amber ? "ltr ltr-a" : "ltr ltr-w";
    s.textContent = ch;
    s.setAttribute("aria-hidden", "true");
    s.style.display = "inline-block";
    s.style.opacity = "0";
    if (amber) s.style.color = "var(--amber)";
    frag.append(s);
    return s;
  };
  for (const node of [...h1.childNodes]) {
    const amber = node.nodeName === "SPAN";
    for (const ch of node.textContent ?? "") wrap(ch, amber);
  }
  h1.textContent = "";
  h1.append(frag);
}

function hero() {
  const h1 = document.querySelector<HTMLElement>(".hero h1");
  if (h1) splitLetters(h1);
  utils.set(".hero .copy > *", { opacity: 1 });   // children now own their states
  utils.set([".hero .tag", ".hero .value", ".cta a"], { opacity: 0 });

  const tl = createTimeline({ defaults: { ease: "outExpo" } });
  // letters solidify: rise, unblur, and cool from molten amber to white
  tl.add(".ltr-w", {
    opacity: [0, 1],
    translateY: [26, 0],
    filter: ["blur(7px)", "blur(0px)"],
    color: ["#ffb454", "#eef1f5"],
    duration: 950,
    delay: stagger(42),
  }, 0);
  tl.add(".ltr-a", {
    opacity: [0, 1],
    translateY: [26, 0],
    filter: ["blur(7px)", "blur(0px)"],
    duration: 950,
    delay: stagger(42),
  }, 220);
  tl.add(".hero .tag", { opacity: [0, 1], translateY: [16, 0], duration: 750 }, 420);
  tl.add(".hero .value", { opacity: [0, 1], translateY: [16, 0], duration: 750 }, 560);
  tl.add(".cta a", { opacity: [0, 1], translateY: [14, 0], duration: 650, delay: stagger(90) }, 700);
  tl.add("#demoBox", { opacity: [0, 1], scale: [0.965, 1], duration: 1000, ease: "outCubic" }, 500);
}

function countUp(el: HTMLElement) {
  const target = parseInt(el.dataset.count ?? "", 10);
  if (!Number.isFinite(target)) return;
  const suffix = el.dataset.suffix ?? "";
  const obj = { n: 0 };
  animate(obj, {
    n: target,
    duration: 1500,
    ease: "outExpo",
    modifier: utils.round(0),
    onUpdate: () => { el.textContent = obj.n.toLocaleString("en-US") + suffix; },
  });
}

function reveals() {
  // IntersectionObserver triggers, anime tweens: reveal once, never scrub
  const groups: { sel: string; each?: (el: HTMLElement) => void; scale?: boolean }[] = [
    { sel: ".stats", each: el => el.querySelectorAll<HTMLElement>("b[data-count]").forEach(countUp) },
    { sel: ".bento" },
    { sel: "footer" },
  ];
  for (const g of groups) {
    const host = document.querySelector<HTMLElement>(g.sel);
    if (!host) continue;
    const targets = g.sel === ".stats" ? host.querySelectorAll(".stat")
      : g.sel === ".bento" ? host.querySelectorAll(".cell, .bimg")
      : [host];
    const io = new IntersectionObserver(entries => {
      if (!entries.some(e => e.isIntersecting)) return;
      io.disconnect();
      animate(targets, {
        opacity: [0, 1],
        translateY: [24, 0],
        duration: 800,
        ease: "outCubic",
        delay: stagger(90),
      });
      g.each?.(host);
    }, { threshold: 0.2 });
    io.observe(host);
  }
}

function magnetic() {
  for (const a of document.querySelectorAll<HTMLElement>(".cta a")) {
    a.addEventListener("pointermove", e => {
      if (e.pointerType !== "mouse") return;
      const r = a.getBoundingClientRect();
      animate(a, {
        translateX: ((e.clientX - r.left) / r.width - 0.5) * 8,
        translateY: ((e.clientY - r.top) / r.height - 0.5) * 6,
        duration: 180,
        ease: "out(2)",
      });
    });
    a.addEventListener("pointerleave", () => {
      animate(a, { translateX: 0, translateY: 0, duration: 550, ease: "outElastic(1, .55)" });
    });
  }
}

function cursorGlow() {
  for (const cell of document.querySelectorAll<HTMLElement>(".cell")) {
    cell.addEventListener("pointermove", e => {
      const r = cell.getBoundingClientRect();
      cell.style.setProperty("--mx", `${e.clientX - r.left}px`);
      cell.style.setProperty("--my", `${e.clientY - r.top}px`);
    });
  }
}

if (root.classList.contains("anim")) {
  try {
    window.__landingMotion = true;
    hero();
    reveals();
    magnetic();
    cursorGlow();
  } catch (err) {
    console.error("[solidify] landing motion failed:", err);
    root.classList.remove("anim");
    for (const el of document.querySelectorAll<HTMLElement>("[style]")) el.style.opacity = "";
  }
}
