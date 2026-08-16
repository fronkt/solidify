# Lessons

## Never edit source files while the browser-driven verify suite is running

**What happened:** ran `npm run test` in the background, then kept editing `src/*.ts` files
(M3's lab.ts/main.ts/share.ts changes) while it was still in flight. Vite's dev server has HMR
file-watching on, so each edit pushed a live page reload to whatever Puppeteer test was mid-run
against it. The result looked exactly like a random Puppeteer crash — `Error: Execution context
was destroyed, most likely because of a navigation` — right in the middle of a GPU test (once
in `verify-heattreat-gpu.mjs` entering 3D, once in `verify-optimizer.mjs`). This was
misdiagnosable as a bug in the code under test (sim3d.ts/shaders3d.ts), and burned real time
proving it wasn't one: stashed the changes, re-ran the same gate against pre-change code (passed
clean), restored the changes, re-ran the same gate ALONE (passed clean too) — only then did a
second full-suite run reproduce it, and only because edits were still landing mid-run. The
actual cause was a `[vite] page reload src/share.ts` log line sitting right before the crash.

**Rule:** once `npm run test` (or any single browser-driven `verify-*.mjs`) is launched against
the dev server, make NO further edits to `src/**` until it finishes. If a checkpoint run is
launched in the background to keep working in parallel, only touch files the suite doesn't
import (docs, this file, plan files) until it completes — anything else invalidates the run
before it's even finished, and a crash produced this way is easy to mistake for a real
regression. Prefer running the full suite as one deliberate foreground checkpoint after a batch
of edits is done, not interleaved with them.

## An identity assertion needs a liveness assertion beside it

**What happened:** `RNG-REPRO` (v7.0 C0a) was written to prove that two casts at the same seed
produce the same casting. Its first run reported `sameSeedRepeats: true` — and was wrong. All
three arms had produced `fracSolid: 0`: the cast was driven entirely through `stepSync`, but the
emergent nucleation model only fires when a stats readback lands, and those arrive on the *frame*
loop. So no sites fired, nothing solidified, and three empty results compared equal. The gate was
only saved by its own difference-half (`differentSeedDiffers: false`), which is the half that had
felt redundant while writing it.

**Rule:** any gate whose assertion is "these two runs agree" must FIRST assert that the runs did
something — solid fraction above a floor, a grain count above a floor, a non-empty result set.
`A === B` is trivially true for two nulls, two zeros and two empty arrays, and every one of those
is a plausible outcome of a harness bug rather than of the physics being right. State the liveness
condition in the gate's own output (`castGrew: true`) so a future reader can see it was checked.

Corollary: when writing the difference-half of a symmetry gate feels redundant, that is exactly
the half that catches the harness. Keep it.

## An ordering assertion needs its operands' domains asserted first

**What happened:** `CALIB-MIX-OWN` (v7.1 P1) checks that the model's reference interval is wider
than the alloy's real primary freezing range, and wrote it as `dT0 > primary`, where
`primary = T_L − T_inv`. It passed on every preset. It was also, for 4340 steel, comparing
77.8 against **−1.7**: that alloy's four non-carbon solutes pull its liquidus below the Fe–C
peritectic, so there is no primary range at all, and the string the gate was guarding read "the
primary actually freezes over only -1.7 K … so the model interval is 77822335467.5x the real
one". A shipped preset, a nonsense readout, and a green gate. It was found by an adversarial
review, not by the gate.

**Rule:** before asserting `a > b`, `a / b`, or `a` within a band of `b`, assert that `b` is in
the domain where the comparison MEANS anything — positive, finite, non-empty. An ordering against
a value that should not exist is satisfied for free, and it is satisfied most confidently in
exactly the case that is broken. Where `b` can legitimately fail to exist, the gate needs two
branches and must assert the RIGHT one fired: that the comparison is printed when `b` exists, and
that it is *not* printed when it does not.

Corollary, same milestone: `Math.max(1e-9, b)` in a denominator is this bug wearing a guard. It
converts "this comparison is meaningless" into "this comparison is 7.8×10¹⁰", which reads as a
measurement. Refuse the comparison instead of flooring it.

## A truthiness test on a property lookup is not a membership test

**What happened:** `derive()`'s new refusal filter asked `if (!base.solutes[el])` to decide
whether a solute key was one this model carries. `base.solutes.constructor` is inherited from
`Object.prototype` and is truthy, so `{constructor: 5}` passed the filter as a valid solute, and
`s.m`, `s.k` and `s.mass` were all `undefined`. NaN propagated into `dTL`, `Q`, `mLiq` and `dSol`,
and `refusals` came back **empty** — the exact silent drop the refusal channel had just been added
to close. `ALLOY-REFUSE-NAMED` could not see it, because every shape it drove was a key that
correctly fails the check.

**Rule:** use `Object.hasOwn` for "is this key one of mine". And when a gate exists to prove that
bad input is NAMED, drive at least one input that the guard is likely to let through rather than
only inputs it obviously rejects — otherwise the gate tests the happy path of the guard. Pair it
with an assertion that no non-finite number escaped into the returned bundle, so naming and
containment are checked separately.
