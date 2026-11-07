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
// a treatment marks after syncing the clock, a census read carries the reset
// count it was issued under.
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

// 7. REPLAY-LEDGER-STALE — a census read issued before a reset and resolving
//    after it (the old cast's 0.9) is dropped when it carries the generation
//    it was issued under, so the fresh pour's 0.02 is not a remelt. The
//    falsification arm is the call shape this replaced (no generation): the
//    stale 0.9 seeds the baseline and the fresh pour is refused as remelted.
{
  const withGen = new R.ReplayLedger(), noGen = new R.ReplayLedger();
  const g0 = [withGen, noGen].map(L => { L.observe(4, 0.9); return L.generation; });
  for (const L of [withGen, noGen]) L.clock(0);   // reset: the frame sees the clock run back
  const bumped = withGen.generation === g0[0] + 1;
  withGen.observe(0.01, 0.9, g0[0]);              // the stale read lands
  noGen.observe(0.01, 0.9);
  for (const L of [withGen, noGen]) { L.observe(0.02, 0.02, L.generation); L.observe(0.03, 0.03, L.generation); }
  // and a current read is still a measurement: a real fall after it marks;
  // a read with no generation is taken as current even across a reset that
  // observe itself detects (its 0.02 seeds the new baseline, so 0.01 marks)
  const live = new R.ReplayLedger();
  live.observe(1, 0.5, live.generation); live.observe(2, 0.3, live.generation);
  const plain = new R.ReplayLedger();
  plain.observe(5, 0.9); plain.observe(0.01, 0.02); plain.observe(0.02, 0.01);
  check("REPLAY-LEDGER-STALE", bumped && withGen.reason === null && noGen.reason === R.REASON.remelt
    && live.reason === R.REASON.remelt && plain.reason === R.REASON.remelt,
    { generationBumpsOnReset: bumped, staleDropped: withGen.reason === null, oldShapeRefusesFreshPour: noGen.reason === R.REASON.remelt,
      currentStillMarks: live.reason === R.REASON.remelt, omittedIsCurrent: plain.reason === R.REASON.remelt });
}

await server.close();
console.log(failures ? `done — ${failures} FAILED` : "done");
if (failures) process.exitCode = 1;
