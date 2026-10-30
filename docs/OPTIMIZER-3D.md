# 3D casting optimizer

In the volume, open **optimizer**, choose a target grain diameter and casting
budget, then press **run**. Entry is paused. The search evaluates real castings
on the selected volume grid using the current material, composition, seed and
cell pitch. Camera and lens controls remain available during a search.

The default limits are sixteen castings and 60,000 delivered substeps per
casting. The panel offers smaller budgets and up to 100,000 steps. A slow
cooling schedule may remain unfinished within that fixed resource limit.

The objective is the diameter of a sphere with the mean censused grain volume:
`d = cbrt(6 meanVolumeVoxels / pi)`. Known material scales display micrometres;
the unscaled model displays cells. The census excludes grains below the native
volume threshold `max(64, n^3 * 1e-5)`. The target refers to these censused grains.

The search varies early, middle and late cooling rates, inoculant site count,
and initial melt temperature. Trials use free casting with twins disabled and
the qualitative Kobayashi model. Calibrated 3D remains a separate scientific
validation task and is visibly refused by this optimizer.

Every trial uses fixed batches of sixteen delivered substeps. Nucleation sees
the charged liquidus and measured temperature; all activated seed uploads drain
before growth continues. Only a finite nonzero-grain census at solid fraction
at least 0.92 can win. An unfinished trial remains invalid when its step budget
ends. The bounded report identifies the best valid recipe found; it does not
promise that the target is attainable.

Pause permits the current batch to settle. Exit restores the original setup
armed; it does not restore the previous GPU field. Changing the target starts a
new paused search and discards the previous target's population and scores.

**Apply recipe** stages the measured winner armed on the same grid. Running it
uses the same casting clock and stops at the measured completion condition.
Recipe links retain the dimension, grid, material, seed, pitch, three-stage
schedule, budget and lossless fixed model parameters. A recipient that cannot
admit the original grid or model receives a visible refusal. Continuing after a
completed replay leaves the measured casting protocol.

The convergence figure, CSV and run archive preserve measured diameters,
relative errors, valid/invalid outcomes, delivered steps and search provenance.
The legacy 2D optimizer retains its ASTM grain-number objective.

## Verification

`node scripts/verify-optimizer3d.mjs verify-out/optimizer3d 5199` runs the real
WebGPU acceptance flow. It independently recounts volume voxels and grain IDs,
checks pause hashes, invalid casts and late-census cancellation, applies and
shares the winner, replays it twice, inspects phone controls and exercises the
legacy 2D path. Source files must remain frozen throughout the browser run.
GPU acceptance evidence is recorded separately after execution.

`node scripts/verify-optimizer3d-model.mjs` also runs seven browser-free model
checks in CI, including finite-score ordering, overflow refusal, charged
liquidus bounds and independent volume/diameter arithmetic.
