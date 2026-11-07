// REPLAY-* — the time scrubber's ledger and its reconstruction rule, checked
// without a browser.
//
// The replay rebuilds the solid at an earlier time t from the one piece of
// history the solvers keep: each cell's freeze time. "Solid then" is "solid
// now AND froze strictly before t". Two things make that exact or wrong, and
// both are pinned here:
//
//   1. the ledger (src/replay.ts) must refuse once anything remelted solid or
//      moved grain boundaries, must clear on a reset (sim time running back),
//      and must not trip on interface noise;
//   2. the rule as the GPU runs it (shaders.ts loadState, render3d.ts
//      SCRUB3_WGSL) must use the STRICT comparison: a whole frame batch
//      freezes stamped with its START time, so "<=" would show the next batch
//      at a frame boundary, one batch early.
//
// The GPU behaviour itself (replayed masks against masks captured live) is
// verify-visual-gpu.mjs (VIS-REPLAY-*); this file pins what can be pinned
// without a device, including the ledger's call contracts the app relies on:
// a treatment marks after syncing the clock, a census read that a reset
// overtook is dropped before any consumer, and the scrub is owned by the ledger.
//
//   node scripts/verify-replay.mjs
import { createServer } from "vite";
import { readFileSync } from "node:fs";

const server = await createServer({
  server: { middlewareMode: true }, appType: "custom", logLevel: "error",
});
const R = await server.ssrLoadModule("/src/replay.ts");
const S = await server.ssrLoadModule("/src/shaders.ts");

let failures = 0;
const check = (name, ok, detail) => {
  if (!ok) failures++;
  console.log(name, ok ? "OK" : "FAIL", detail === undefined ? "" : JSON.stringify(detail));
};

// 1. REPLAY-LEDGER-NOISE — a growing melt with interface flicker below the
//    threshold stays replayable; the same series with one real fall does not.
//    The falsification arm proves the threshold is live (a drop just over it
//    marks, one just under it does not), so "clean" is not vacuous.
{
  const grow = new R.ReplayLedger();
  let t = 0, fs = 0;
  for (let i = 0; i < 400; i++) {
    t += 0.01;
    fs = Math.min(0.95, fs + 0.002) + (i % 7 === 3 ? -R.FS_DROP * 0.6 : 0);
    grow.observe(t, fs);
  }
  const under = new R.ReplayLedger(), over = new R.ReplayLedger();
  under.observe(1, 0.5); under.observe(2, 0.5 - R.FS_DROP * 0.98);
  over.observe(1, 0.5); over.observe(2, 0.5 - R.FS_DROP * 1.02);
  check("REPLAY-LEDGER-NOISE",
    grow.reason === null && under.reason === null && over.reason === R.REASON.remelt,
    { growing: grow.reason, justUnder: under.reason, justOver: over.reason === R.REASON.remelt });
}

// 2. REPLAY-LEDGER-RESET — a marked ledger clears when sim time runs back, and
//    the new melt starts a new fraction baseline (a fresh pour's low fraction
//    is not a fall from the old pour's high one).
{
  const L = new R.ReplayLedger();
  L.observe(5, 0.8);
  L.mark(R.REASON.reheat);
  const marked = L.reason === R.REASON.reheat;
  L.clock(0.01);
  const cleared = L.reason === null;
  L.observe(0.02, 0.05);
  L.observe(0.03, 0.06);
  check("REPLAY-LEDGER-RESET", marked && cleared && L.reason === null,
    { marked, clearedOnClockBack: cleared, freshPour: L.reason });
}

// 3. REPLAY-LEDGER-FIRST — the first cause stands (the strip explains the
//    event that actually broke the history), and NaN fractions are ignored.
{
  const L = new R.ReplayLedger();
  L.observe(1, NaN);
  const nanIgnored = L.reason === null;
  L.mark(R.REASON.weld);
  L.mark(R.REASON.anneal);
  L.observe(2, 0.0);
  check("REPLAY-LEDGER-FIRST", nanIgnored && L.reason === R.REASON.weld,
    { nanIgnored, reason: L.reason });
}

// 4. REPLAY-CLAMP — requested times land in [0, now]; NaN means now.
{
  const L = new R.ReplayLedger();
  const got = [L.clamp(-1, 3), L.clamp(1.5, 3), L.clamp(9, 3), L.clamp(NaN, 3), L.clamp(2, -1)];
  const want = [0, 1.5, 3, 3, 0];
  check("REPLAY-CLAMP", got.every((v, i) => v === want[i]), { got, want });
}

// 5. REPLAY-RULE-STRUCTURE — the rule the GPU runs, read from the sources:
//    strict "<" against the replay time, phi >= 0.5, in both dimensions; and
//    every 2D render read of the state texture goes through loadState, so no
//    lens can bypass the replay and paint the present into the past.
{
  const W = S.RENDER_WGSL;
  const load = W.match(/fn loadState[\s\S]*?\n}/)?.[0] ?? "";
  const rule2 = /s\.r >= 0\.5 && s\.a < R\.scrubT/.test(load);
  const direct = (W.match(/textureLoad\(state,/g) ?? []).length;
  const r3 = readFileSync(new URL("../src/render3d.ts", import.meta.url), "utf8");
  const scrub3 = r3.match(/const SCRUB3_WGSL = [\s\S]*?`;/)?.[0] ?? "";
  const rule3 = /textureLoad\(state, c, 0\)\.r >= 0\.5 && textureLoad\(age, c, 0\)\.r < S\.x/.test(scrub3);
  const noLe = !/<= ?R\.scrubT/.test(load) && !/<= ?S\.x/.test(scrub3);
  check("REPLAY-RULE-STRUCTURE", rule2 && rule3 && noLe && direct === 1,
    { rule2, rule3, strictOnly: noLe, directStateLoadsIn2DRender: direct });
}

// 6. REPLAY-LEDGER-TREAT — a treatment marks the ledger at the call, clock
//    first (main.ts markTreated). The case that needs the order: a reset and a
//    fixed-step re-cast with no frame in between (sim time 5 -> 0 -> 3), then a
//    treatment, then the next frame's clock(3). Clock-then-mark keeps the mark;
//    the falsification arm, mark alone, loses it to that frame's clock (3 < 5
//    reads as the reset), and the replay would paint treated ids.
{
  const ordered = new R.ReplayLedger(), naive = new R.ReplayLedger();
  for (const L of [ordered, naive]) { L.observe(5, 0.9); L.clock(5); }
  ordered.clock(3); ordered.mark(R.REASON.anneal);
  naive.mark(R.REASON.anneal);
  for (const L of [ordered, naive]) L.clock(3);   // the next frame
  check("REPLAY-LEDGER-TREAT", ordered.reason === R.REASON.anneal && naive.reason === null,
    { clockThenMark: ordered.reason === R.REASON.anneal, markAloneLost: naive.reason === null });
}

// 7. STATS-STALE-READ — a census issued before a reset (clearMelt,
//    resetArmed, a lab pour) or a grid swap, and landing after it, describes
//    the OLD field and is dropped before ANY frame-loop consumer sees it
//    (src/fieldstamp.ts). Three parts:
//    (a) the stamp: current with no reset; stale after the owner's reset and
//        after a swap to another solver object, and against no solver;
//    (b) the consequence, through the real ledger: the guarded loop drops the
//        old cast's 0.9 and the fresh pour stays replayable; the falsification
//        arm consumes it, as the loop did, and the fresh pour's 0.02 is refused
//        as remelted (the same stale read put a ΔT on the HUD after its reset);
//    (c) the wiring, read from the sources: both solvers bump fieldGen first
//        thing in reset(); each frame-loop readStats is stamped before it is
//        issued and its callback's first guard is stillCurrent, with every
//        consumer (replay ledger, nucleation, lab, HUD, analysis, challenge,
//        heat census) after that guard.
{
  const FS = await server.ssrLoadModule("/src/fieldstamp.ts");
  const a = { fieldGen: 3 }, b = { fieldGen: 3 };
  const st = FS.stampField(a);
  const fresh = FS.stillCurrent(st, a);
  a.fieldGen++;
  const afterReset = FS.stillCurrent(st, a), afterSwap = FS.stillCurrent(FS.stampField(b), a), none = FS.stillCurrent(st, null);
  const stamp = fresh && !afterReset && !afterSwap && !none;
  // (b) the old cast at fs 0.9 is read; the melt resets before it lands
  const run = guarded => {
    const L = new R.ReplayLedger(), sim = { fieldGen: 0, simTime: 4 };
    L.observe(4, 0.85);
    const issued = FS.stampField(sim);
    sim.fieldGen++; sim.simTime = 0;              // clearMelt: a fresh pour
    L.clock(0);                                   // the next frame
    sim.simTime = 0.01;
    if (!guarded || FS.stillCurrent(issued, sim)) L.observe(sim.simTime, 0.9);   // the stale read lands
    L.observe(0.02, 0.02); L.observe(0.03, 0.03);
    return L.reason;
  };
  const guardedReason = run(true), unguardedReason = run(false);
  const consequence = guardedReason === null && unguardedReason === R.REASON.remelt;
  // (c) wiring
  const src = f => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
  const bumpsFirst = ["sim.ts", "sim3d.ts"].map(f => /\n  reset\(tFar = this\.params\.tFar\) \{\r?\n    this\.fieldGen\+\+;/.test(src(f)));
  const main = src("main.ts");
  const reads = [...main.matchAll(/void (\w+)\.readStats\(\)\.then\(s => \{/g)].map(m => {
    const before = main.slice(Math.max(0, m.index - 400), m.index);
    const body = main.slice(m.index, m.index + 2600);
    const close = body.search(/\r?\n\s*\}\);/);   // the callback's own closing line
    const cb = body.slice(0, close > 0 ? close : body.length);
    const guardAt = cb.indexOf("stillCurrent(");
    const firstIf = cb.indexOf("if (");
    const consumers = ["observe(", "lab.onStats(", "hud.push", "onCensus("].map(k => cb.indexOf(k));
    return { stampedBefore: /stampField\(/.test(before), guardFirst: guardAt > 0 && guardAt - firstIf < 120,
      consumersAfter: consumers.every(c => c > guardAt) };
  });
  const wiring = bumpsFirst.every(Boolean) && reads.length === 2 && reads.every(r => r.stampedBefore && r.guardFirst && r.consumersAfter);
  check("STATS-STALE-READ", stamp && consequence && wiring, {
    stamp: { fresh, afterReset, afterSwap, none }, guardedFreshPour: guardedReason, unguardedFreshPour: unguardedReason === R.REASON.remelt ? "remelt" : unguardedReason,
    resetBumpsFirst: bumpsFirst, frameLoopReads: reads,
  });
}

// 8. REPLAY-SCRUB — the ledger owns the replay time (ReplayLedger.frame). A
//    scrub stands while the strip is offered and nothing invalidates it, and
//    ends on each of: the strip withdrawn (running, or a mode panel opening,
//    which hides the live button too), a reset (the clock running back, which
//    a grid swap or a fresh volume also is), and a mark.
//    Requests are refused while marked. Liveness: each arm starts from a
//    standing scrub, and the one arm with nothing wrong keeps it.
{
  const standing = () => { const L = new R.ReplayLedger(); L.frame(2, true); L.scrub(1, 2); return L; };
  const keep = standing(); const kept = keep.frame(2, true);
  const arms = {
    withdrawn: (() => { const L = standing(); return L.frame(2, false); })(),
    reset: (() => { const L = standing(); return L.frame(0, true); })(),
    marked: (() => { const L = standing(); L.mark(R.REASON.reheat); return L.frame(2, true); })(),
  };
  const refused = (() => { const L = new R.ReplayLedger(); L.frame(2, true); L.mark(R.REASON.weld); L.scrub(1, 2); return L.scrubTime; })();
  const clamped = (() => { const L = new R.ReplayLedger(); L.frame(2, true); L.scrub(7, 2); return L.scrubTime; })();
  check("REPLAY-SCRUB", kept === 1 && Object.values(arms).every(v => v === null) && refused === null && clamped === 2,
    { kept, ...arms, refusedWhileMarked: refused, clampedToNow: clamped });
}

await server.close();
console.log(failures ? `done — ${failures} FAILED` : "done");
if (failures) process.exitCode = 1;
