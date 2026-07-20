// DOM-side motion for the scroll story (anime.js v4): hero copy entrance,
// stat count-ups, composer-act chips/Q/bars, equation typing, magnetic CTAs,
// top-nav reveal. Sim-coupled scroll work (pins, lens/material switching)
// lives in landing.ts. The inline <head> gate adds html.anim only when motion
// is allowed; a watchdog reveals everything if this module never runs.

import { animate, createTimeline, stagger, utils } from "animejs";

declare global { interface Window { __landingMotion?: boolean } }

const root = document.documentElement;

// top-nav reveal runs even for reduced-motion users (it is navigation, not decor)
function topnav() {
  const nav = document.getElementById("topnav")!;
  const hero = document.getElementById("heroAct")!;
  const onScroll = () => nav.classList.toggle("show", scrollY > hero.offsetHeight * 0.72);
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();
}

function countUp(el: HTMLElement, target: number, format: (n: number) => string, duration = 1500) {
  const obj = { n: 0 };
  animate(obj, {
    n: target,
    duration,
    ease: "outExpo",
    modifier: utils.round(0),
    onUpdate: () => { el.textContent = format(obj.n); },
  });
}

function splitLetters(h1: HTMLElement) {
  // rebuild "SOLID<span>IFY</span>" as per-letter spans, preserving the amber
  // span; screen readers keep the intact label
  h1.setAttribute("aria-label", h1.textContent ?? "SOLIDIFY");
  const frag = document.createDocumentFragment();
  for (const node of [...h1.childNodes]) {
    const amber = node.nodeName === "SPAN";
    for (const ch of node.textContent ?? "") {
      const s = document.createElement("span");
      s.className = amber ? "ltr ltr-a" : "ltr ltr-w";
      s.textContent = ch;
      s.setAttribute("aria-hidden", "true");
      s.style.display = "inline-block";
      s.style.opacity = "0";
      if (amber) s.style.color = "var(--amber)";
      frag.append(s);
    }
  }
  h1.textContent = "";
  h1.append(frag);
}

function heroEntrance() {
  const h1 = document.querySelector<HTMLElement>("#wordmark");
  if (h1) {
    splitLetters(h1);
    utils.set(h1, { opacity: 1 });   // letters own their visibility now
  }
  const tl = createTimeline({ defaults: { ease: "outExpo" } });
  // the wordmark solidifies: letters rise, unblur, cool from molten amber to white
  tl.add(".ltr-w", {
    opacity: [0, 1],
    translateY: [30, 0],
    filter: ["blur(8px)", "blur(0px)"],
    color: ["#ffb454", "#eef1f5"],
    duration: 950,
    delay: stagger(46),
  }, 0);
  tl.add(".ltr-a", {
    opacity: [0, 1],
    translateY: [30, 0],
    filter: ["blur(8px)", "blur(0px)"],
    duration: 950,
    delay: stagger(46),
  }, 240);
  tl.add("#heroCopy .tag", { opacity: [0, 1], translateY: [16, 0], duration: 750 }, 500);
  tl.add("#heroCopy .cta", { opacity: [0, 1], translateY: [14, 0], duration: 700 }, 700);
  tl.add(".stats", { opacity: [0, 1], translateY: [14, 0], duration: 700 }, 950);
  tl.call(() => {
    document.querySelectorAll<HTMLElement>(".stats b[data-count]").forEach(el => {
      const suffix = el.dataset.suffix ?? "";
      countUp(el, parseInt(el.dataset.count!, 10), n => n.toLocaleString("en-US") + suffix);
    });
  }, 1000);
}

function composeReveal() {
  const host = document.getElementById("composeAct")!;
  const io = new IntersectionObserver(es => {
    if (!es.some(e => e.isIntersecting)) return;
    io.disconnect();
    animate("#composeAct .chip, #composeAct .arrow", {
      opacity: [0, 1], translateY: [16, 0], duration: 550, ease: "outCubic", delay: stagger(80),
    });
    animate("#qLine", { opacity: [0, 1], duration: 500, delay: 500, ease: "outCubic" });
    const q = host.querySelector<HTMLElement>("#qLine b")!;
    setTimeout(() => countUp(q, parseInt(q.dataset.q!, 10), n => `Q = ${n} K`, 1300), 550);
    animate([".bars", "#composeAct .after", "#composeAct .cta"], {
      opacity: [0, 1], translateY: [16, 0], duration: 650, ease: "outCubic", delay: stagger(160, { start: 700 }),
    });
    for (const fill of host.querySelectorAll<HTMLElement>(".fill"))
      animate(fill, { width: ["0%", `${fill.dataset.w}%`], duration: 1400, delay: 900, ease: "outExpo" });
    for (const b of host.querySelectorAll<HTMLElement>(".barRow b[data-count]"))
      setTimeout(() => countUp(b, parseInt(b.dataset.count!, 10), n => String(n), 1400), 900);
  }, { threshold: 0.35 });
  io.observe(host);
}

function sciReveal() {
  const host = document.getElementById("sciAct")!;
  const eqText = document.getElementById("eqText")!;
  const full = eqText.textContent ?? "";
  const io = new IntersectionObserver(es => {
    if (!es.some(e => e.isIntersecting)) return;
    io.disconnect();
    eqText.textContent = "";
    const obj = { i: 0 };
    animate(obj, {
      i: full.length,
      duration: 2100,
      ease: "linear",
      modifier: utils.round(0),
      onUpdate: () => { eqText.textContent = full.slice(0, obj.i); },
    });
    animate("#sciAct .sub2", { opacity: [0, 1], duration: 600, delay: 1400, ease: "outCubic" });
    animate(".stamp", { opacity: [0, 1], translateY: [14, 0], duration: 550, ease: "outCubic", delay: stagger(140, { start: 1700 }) });
    animate("#sciAct .cta", { opacity: [0, 1], translateY: [14, 0], duration: 650, delay: 2200, ease: "outCubic" });
  }, { threshold: 0.4 });
  io.observe(host);
}

function magnetic() {
  for (const a of document.querySelectorAll<HTMLElement>(".cta a, #topnav nav a.go")) {
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

topnav();

if (root.classList.contains("anim")) {
  try {
    window.__landingMotion = true;
    heroEntrance();
    composeReveal();
    sciReveal();
    magnetic();
  } catch (err) {
    console.error("[solidify] landing motion failed:", err);
    root.classList.remove("anim");
  }
}
