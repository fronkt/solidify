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
