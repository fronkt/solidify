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

## A gate that cannot run reports nothing, which looks exactly like a gate nobody wrote

**What happened:** `verify-regimes.mjs` was pointed at the pre-P3 tree to prove it was not
vacuous — the check every gate in this arc is held to. It printed **zero lines**. Not five
failures: nothing. The first unwrapped call to `PD.shortPhase`, which does not exist on that
tree, threw at the top level of the first block and took the remaining four gates with it. The
run *looked* like a script that had not been added to CI yet, and the exit code was the only
evidence anything had happened at all. v7.1 P1 had already learned the driver-level version of
this — `derive()` threw on an unknown base, so `ALLOY-REFUSE-NAMED` wrapped each driver in
try/catch — and the block-level version was still open.

**Rule:** in a verification script, wrap each named gate in its own try/catch that reports a
FAIL carrying the exception. A gate's job is to produce a verdict; an exception is the absence of
one, and absence is indistinguishable from success in a log nobody reads twice. Then check the
stronger property: at least one clause per gate should be expressible WITHOUT the exports the
milestone adds, so pointing it at the old tree fails for a reason about BEHAVIOUR rather than
about a missing symbol. `PD-CAP-CEILING` states its postcondition over `derive()` alone and
reports "33.2 wt% Cu survived into the derivation" on all 25 pairs; "soluteBound is not a
function" would have proven only that the function is new.

## An assertion that a document contains a small integer is not a gate

**What happened:** the v7.1 P3 prose says the derived ceiling binds for five of the twenty-five
pairs, and the doc gate was handed that count as a claim: recompute 5 from the table, require the
page to contain `"5"`. It passed. It would also have passed against `"35 wt%"`, `"1045 steel"` and
`"0.5"` — the page cannot fail it. Sitting in a list of twenty other claims that genuinely bind,
it read as one more measured fact.

**Rule:** a doc claim earns its place only if its appearance in the text is EVIDENCE. Strings like
`"0.52 wt%"`, `"577 °C"` and `"49 %"` are; a bare small integer, a single word, or a number that is
a substring of common values is not. When the fact is worth gating but the string is not specific
enough, gate it where it is specific — against the table, in the module's own gate — rather than
weakening the doc gate to accommodate it.

## A classification and a bound are different things, and one repair can switch the other off

**What happened:** v7.1 P3's review found that `phasesFor` narrated `ni-W` — the one row
`phasediagram.ts` refuses to draw, because its own numbers say both that the liquidus rises and
that the liquid is the richer phase — with confident phase names and a lever fraction. The fix
was obvious: apply the same geometric test to the CLAIM that P2 applied to the picture. That
repair immediately opened a worse hole. `derive()`'s composition ceiling asked
`phasesFor(...).regime === "PAST-THE-INVARIANT"` to decide whether to refuse a weight, so a row
that now refused to be classified at all also stopped having a ceiling, and 45 wt% tungsten
walked into the melt through the gap the repair had just made.

**Rule:** when a function starts refusing to answer, find every caller that was reading its
answer as a *decision* rather than as a *description*. A composition bound and a phase claim are
different questions about the same row, and only one of them was in doubt: the invariant liquid
is still the composition past which the instrument cannot say what freezes first, whatever else
the row gets wrong. Derive the bound from the datum (`soluteBound` reads `row.Cinv`), not from
the narrator. The general shape: a guard built on top of an interpretation inherits every
refusal that interpretation ever learns to make.

## Convergence across independent reviewers is the signal; a lone finding is a lead

**What happened:** six review lenses ran over the v7.1 P3 diff without seeing each other's
output and returned 44 findings. Four of the six independently reported the same defect — that a
reactant-peritectic's two-phase end state is false above the reaction's product composition, and
that both shipped steel presets print it. It was the single most serious thing in the milestone,
it had passed five of my own new gates, and I had verified the branch by hand and believed it
correct. Roughly two-thirds of the other findings did not survive their refuters.

**Rule:** weight a finding by how many independent lenses reached it, not by how confidently any
one of them argued. Convergence means the defect is visible from several directions, which is
exactly what a defect in the *claim* rather than in the *code* looks like — every lens can read
the printed sentence, and no gate can, because the gate was written by the same person who wrote
the sentence. And when review does find something that survives, check whether the milestone's
own plan already asked for it: this one had ("regime I is honest about itself: equilibrium says
single-phase, Scheil says a real fraction freezes as eutectic anyway"), and the implementation
had quietly dropped half the requirement.

## Data that is only checked against itself is not checked

**What happened:** v7.1 P4 landed a 118-element table and six gates that all consume it. Every
one of them read the metallic-radius column and not one could see that seven rows carried the
wrong quantity: the CN8→CN12 correction had been applied to the s-block bcc metals and forgotten
on the d-block ones, so V, Cr, Nb, Mo, Ta, W and Ra held the nearest-neighbour radius a·√3/4
while the file's own source string said in as many words that they did not. An independent audit
found it in minutes, by a route no gate had: it recomputed the radius from the density. The tell
was that W and Re both read 137.1 pm — Re is hcp, so 137 is genuinely its CN12 value, and the
coincidence existed only because tungsten was uncorrected.

**Rule:** for every column of data a milestone ships, find a SECOND physical quantity that
constrains it and gate on the relation between them, not on the value. ΔH_vap and T_b are tied by
Trouton's rule; a metallic radius and a density are tied by the close-packed-equivalent radius;
an atomic mass and Z are tied by the ordering. A gate that reads a number and checks it against
another number in the same file is checking a transcription, not a fact. The corollary is the
sharper half: a defect that survives every gate you wrote is usually one where the gate and the
datum came from the same head at the same time, which is exactly what an outside reader is for.

## Measure, then pin — and the values are the pin, not the list

**What happened:** having built the density cross-check, I wrote its allow-list of legitimate
outliers — the metals with open or distorted structures — from intuition, guessing Ga at 7.2 %,
Sn at 3.6, Bi at 4.0, Po at 4.0. The measured values were 7.2, 4.1, 8.5 and 12.7. The gate
rejected my guesses on the first run, which is the correct outcome arriving by the wrong route:
I had written the tolerance before taking the measurement, in a gate whose whole purpose is to
stop exactly that.

**Rule:** this repo already says "never write a tolerance before measuring it". Extend it to
allow-lists: an exemption is not a name, it is a name AND a measured value AND the reason. A list
of bare names exempts the row from the check entirely, so the next genuine error inside it is
invisible — which is how a 53-entry Trouton exemption list would have rotted. Pin the number,
give it a tolerance, and make each entry state its mechanism in the data file itself, so the
exemption has to be re-justified whenever the row is edited.

## A distinctness check over interpolated strings measures nothing

**What happened:** P4's plan asked the tier gate to assert "the DISTINCT reason set size ≥ 12, so
700 refusals cannot collapse into one generic sentence". Implemented literally it passes at 422
distinct strings out of 708 — because every refusal interpolates its own element and its own
base, so a file that said "X is not available in Y" seven hundred times would satisfy it
comfortably. The check would have been green on precisely the failure it was written to prevent.

**Rule:** before asserting that a set of generated strings is diverse, ask what the assertion is
green on when the thing you fear has happened. If the answer is "still green", the metric is
measuring the interpolation and not the writing. Normalise away everything the template
substitutes — names, symbols, numbers — and count what is left, the SKELETON. Then add the clause
that actually bites: no two distinct reasons may produce the same skeleton, because a refusal
naming the wrong mechanism is a wrong statement rather than an absent one.

## A function that claims to mirror another must be driven on the inputs the other refuses

**What happened:** `admit()`'s docblock promised that an admission and a pour "can never disagree",
and `EL-TIER-TOTAL` drove all 708 pairs through both `admit()` and `derive()` to prove it. Both
passed. Both were wrong: `derive()` refuses four things `admit()` did not carry — a non-finite
weight, a negative one, one over 100 — and the gate never noticed because it drove only the probe
composition, which is always a good number. `admit("fe","Cr",NaN)` returned ASSESSED with an
advisory that read "Cr at NaN wt% exerts 0.0e+0 atm, which is negligible", the NaN having been
swallowed into a clean-looking zero by a `n + nb > 0 ? … : 0` guard three functions away.

**Rule:** when one function claims parity with another, enumerate the inputs the OTHER one
refuses and drive every one of them through both. The interesting half of a mirror is never the
values both accept. And when a readout is handed a number it cannot use, describe it rather than
echo it — "that weight is not a number at all" instead of the literal string NaN — then gate on
the string never appearing anywhere a user can read.
