// DOM-side motion for the scroll story (anime.js v4): the hero opening's
// entrance, the composer act's reveal (chips, Q, the Al–Si marker, bars), the
// science act's rows, and the header's state (src/design/header.ts).
// Sim-coupled scroll work (pins, lens/material switching) lives in landing.ts;
// the hero's scroll scrub (frames, chapter text, the feature rail) lives in
// hero.ts. The inline <head> gate adds html.anim only when motion is allowed; a
// watchdog reveals everything if this module never runs. Every reveal is
// opacity and a short translate, nothing else.

import { animate, stagger, utils } from "animejs";
import { topnav } from "./design/header";

declare global { interface Window { __landingMotion?: boolean } }

const root = document.documentElement;

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

/** The hero opening (kicker, title, body, CTAs) rises into place once, in
 *  order: opacity and a short translate, no blur. */
function heroEntrance() {
  animate("#heroOpen > *", {
    opacity: [0, 1], translateY: [16, 0], duration: 700, ease: "outCubic", delay: stagger(80, { start: 80 }),
  });
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
  // the pour's value is the number inside #pdC; its element and unit stay put
  const cEl = document.querySelector<HTMLElement>("#pdC [data-v]");
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
    cEl.textContent = c.toFixed(1);
    // the crossing itself: at and past C_SM the casting is two phases, and the
    // end state must land back on exactly the markup the page shipped with
    const past = st.t >= 1 ? rich0 : c >= cSm;
    rich.classList.toggle("on", past);
    lean.classList.toggle("on", st.t >= 1 ? lean0 : !past);
    phEl.textContent = st.t >= 1 ? phase0 : past ? "(Al) + (Si)" : "(Al) only";
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
    animate("#composeSpec", { opacity: [0, 1], duration: 500, delay: 500, ease: "outCubic" });
    // the Q row's value is the number alone; its unit is a sibling span
    const q = host.querySelector<HTMLElement>("#qLine b")!;
    // REWIND BEFORE THE ROW FADES IN, the same way pdMarker does below. P6 made
    // the shipped text the FINAL value so a reduced-motion reader is not left
    // staring at a zero. But countUp starts at zero and overwrites, so without
    // this the reader is shown the answer at partial opacity, watches it drop to
    // near nothing, and waits while it climbs back. Measured before the fix:
    // "44.7 K" readable at 0.909 opacity, "3.0 K" at 0.937, "44.7 K" again only
    // at t = 2.7 s. These two lines run only under html.anim, so the fallback
    // copy is untouched.
    q.textContent = "0";
    setTimeout(() => countUp(q, parseInt(q.dataset.q!, 10), n => String(n), 1300), 550);
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

/** The Al–Si figure's text is sized in the SVG's user units, so it grows with
 *  the figure: drawn 918 px wide (1920 x 1080) an 11-unit tick is 25 px on
 *  screen, heavier than the copy beside it. --pd-k is the figure's user units
 *  per CSS px, and index.html multiplies the tick size by it, so the ticks
 *  stay at the tick role's 11 px at any width. Without this module the text
 *  scales as drawn. Geometry is untouched (PD-LANDING-FIGURE reads it). */
function pdTextScale() {
  const fig = document.getElementById("pdFig") as SVGSVGElement | null;
  const units = fig?.viewBox.baseVal.width ?? 0;
  if (!fig || !(units > 0)) return;
  const set = () => {
    const w = fig.getBoundingClientRect().width;
    if (w > 0) fig.style.setProperty("--pd-k", (units / w).toFixed(4));
  };
  new ResizeObserver(set).observe(fig);
  set();
}

/** The science act's rail rises row by row, then its links. The equations are
 *  set whole: no typing, no cursor. */
function sciReveal() {
  const host = document.getElementById("sciAct")!;
  const io = new IntersectionObserver(es => {
    if (!es.some(e => e.isIntersecting)) return;
    io.disconnect();
    animate("#sciAct .spec__row", { opacity: [0, 1], translateY: [14, 0], duration: 550, ease: "outCubic", delay: stagger(90, { start: 150 }) });
    animate("#sciAct .cta", { opacity: [0, 1], translateY: [14, 0], duration: 600, delay: 500, ease: "outCubic" });
  }, { threshold: 0.3 });
  io.observe(host);
}

topnav();
pdTextScale();

if (root.classList.contains("anim")) {
  try {
    window.__landingMotion = true;
    heroEntrance();
    composeReveal();
    sciReveal();
  } catch (err) {
    console.error("[solidify] landing motion failed:", err);
    root.classList.remove("anim");
  }
}
