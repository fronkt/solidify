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

function countUp(el: HTMLElement, target: number, format: (n: number) => string,
  duration = 1500, decimals = 0) {
  const obj = { n: 0 };
  animate(obj, {
    n: target,
    duration,
    ease: "outExpo",
    modifier: utils.round(decimals),
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

/**
 * The composition marker walking across the Al–Si diagram until it crosses the
 * solubility line (v7.1 P6, replacing an animated grain count the science page
 * had retracted twice).
 *
 * EVERY NUMBER IS READ BACK OUT OF THE MARKUP — the chord's origin from the
 * solidus line's own endpoint, the pour from the dot's shipped position, the
 * two compositions from data-c / data-csm. Nothing chemical is written here,
 * which is what keeps phasedata.ts out of the landing chunk and leaves exactly
 * one file (index.html) holding the figure's numbers. PD-DOC-CONSTANTS checks
 * that those numbers are the row's; PD-LANDING-FIGURE re-derives where they are
 * DRAWN, because appearing in the file and being in the right place on the
 * chord are two claims and the first one alone let a marker sit 74 px off its
 * own liquidus with the whole browser-free suite green.
 *
 * The dot ships at its FINAL position so that a reduced-motion reader, or one
 * whose modules never boot, gets the finished figure rather than a marker
 * parked at zero — the defect the old bars had, which printed "0" grains to
 * anyone who had asked their OS for less animation.
 */
function pdMarker(host: HTMLElement) {
  const fig = host.querySelector<SVGSVGElement>("#pdFig");
  if (!fig) return;
  const sol = fig.querySelector<SVGLineElement>(".sol");
  const dot = fig.querySelector<SVGCircleElement>(".dot");
  const drop = fig.querySelector<SVGLineElement>(".drop");
  const lean = fig.querySelector<SVGRectElement>(".band.lean");
  const rich = fig.querySelector<SVGRectElement>(".band.rich");
  const cEl = document.getElementById("pdC");
  const phEl = document.getElementById("pdPhase");
  if (!sol || !dot || !drop || !lean || !rich || !cEl || !phEl) return;
  const num = (el: Element, a: string) => parseFloat(el.getAttribute(a) ?? "");
  const x0 = num(sol, "x1"), y0 = num(sol, "y1");
  const x1 = num(dot, "cx"), y1 = num(dot, "cy");
  const cEnd = parseFloat(fig.dataset.c ?? ""), cSm = parseFloat(fig.dataset.csm ?? "");
  if (![x0, y0, x1, y1, cEnd, cSm].every(Number.isFinite)) return;
  const lean0 = lean.classList.contains("on"), rich0 = rich.classList.contains("on");
  const phase0 = phEl.textContent ?? "";

  const st = { t: 0 };
  const paint = () => {
    const c = cEnd * st.t;
    const x = x0 + (x1 - x0) * st.t, y = y0 + (y1 - y0) * st.t;
    dot.setAttribute("cx", x.toFixed(2));
    dot.setAttribute("cy", y.toFixed(2));
    drop.setAttribute("x1", x.toFixed(2));
    drop.setAttribute("x2", x.toFixed(2));
    drop.setAttribute("y1", y.toFixed(2));
    cEl.textContent = `Si ${c.toFixed(1)} wt%`;
    // the crossing itself: at and past C_SM the casting is two phases, and the
    // end state must land back on exactly the markup the page shipped with
    const past = st.t >= 1 ? rich0 : c >= cSm;
    rich.classList.toggle("on", past);
    lean.classList.toggle("on", st.t >= 1 ? lean0 : !past);
    phEl.textContent = st.t >= 1 ? phase0 : past ? "(Al) + (Si)" : "(Al) — everything dissolves";
  };
  paint();   // rewind to 0 wt% before the row fades in, so nothing jumps
  animate(st, { t: 1, duration: 1500, delay: 900, ease: "inOutCubic", onUpdate: paint });
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
    // REWIND BEFORE THE ROW FADES IN, the same way pdMarker does below. P6 made
    // the shipped text the FINAL value so a reduced-motion reader is not left
    // staring at a zero — but countUp starts at zero and overwrites, so without
    // this the reader is shown the answer at partial opacity, watches it drop to
    // near nothing, and waits while it climbs back. Measured before the fix:
    // "44.7 K" readable at 0.909 opacity, "3.0 K" at 0.937, "44.7 K" again only
    // at t = 2.7 s. These two lines run only under html.anim, so the fallback
    // copy is untouched.
    q.textContent = "Q = 0 K";
    setTimeout(() => countUp(q, parseInt(q.dataset.q!, 10), n => `Q = ${n} K`, 1300), 550);
    animate([".pdrow", ".barhead", ".bars", "#composeAct .after", "#composeAct .cta"], {
      opacity: [0, 1], translateY: [16, 0], duration: 650, ease: "outCubic", delay: stagger(140, { start: 650 }),
    });
    pdMarker(host);
    for (const fill of host.querySelectorAll<HTMLElement>(".fill"))
      animate(fill, { width: ["0%", `${fill.dataset.w}%`], duration: 1400, delay: 1300, ease: "outExpo" });
    for (const b of host.querySelectorAll<HTMLElement>(".barRow b[data-count]")) {
      const dec = parseInt(b.dataset.dec ?? "0", 10);
      const suffix = b.dataset.suffix ?? "";
      b.textContent = (0).toFixed(dec) + suffix;
      setTimeout(() => countUp(b, parseFloat(b.dataset.count!),
        n => n.toFixed(dec) + suffix, 1400, dec), 1300);
    }
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
