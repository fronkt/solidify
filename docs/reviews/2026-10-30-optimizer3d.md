# 3D optimizer implementation review

Reviewed implementation: `9d5fa9ab80314976a024366c9240db04e10a8ffe`, compared
with baseline `178d367a3f0bf1e568f8147a23266ba956a1fdd2`.
PR: https://github.com/fronkt/solidify/pull/4 (base `v7-experiments`).

The module, integration, test design and visual surface received separate
reviews. Root retained sole GPU ownership; reviewers did not run competing
browsers or change frozen sources. No blocking finding remains.

## Findings resolved

- A finite positive API target could overflow relative error, or produce a
  valid error above the old fixed invalid penalty. The model now refuses
  nonfinite errors and reserves `Number.MAX_VALUE` strictly above every accepted
  score. CMA uses fitness for ordering. Seven independent arithmetic checks
  include tiny targets, overflow, volume conversion, charged liquidus bounds,
  invalid censuses, cooling boundaries and copy isolation. Both offending cases
  failed before the change and pass afterward.
- Changing the target and exiting during an awaited census could discard the
  clock's current cooling write while the parent retained an older snapshot.
  Reset now captures the current expected parameters before cancellation. A
  separately scoped CPU lifecycle reproducer failed before and passes after.
  The real GPU regression crosses a cooling stage at solid fraction .330226,
  holds the actual census, changes the target and exits. Cooling returns from
  .3312471821 to its original .123; no stale result becomes a winner.
- The initial 9,000-step resource budget was too short at native `dt=.00009`.
  Two actual Al96-cube trials stopped at solid fractions .3894 and .2831 and
  were correctly refused. The default is 60,000 steps, with smaller budgets and
  a 100,000 option. Cooling bounds, native equations and .92 completion were
  preserved. Low-cooling candidates may still exhaust their declared budget.
- Resizing an open panel from desktop to phone could leave the rail drawer
  hiding the transport. The existing drawer rule now also applies on resize.
  Explicit drawer opening remains available. The settled 390 x 844 panel fits
  without horizontal overflow and exposes run and exit.
- The original share test changed only the hash and reused the old document.
  Its initial complete run is explicitly review-refused as fresh-share proof.
  The corrected test navigates through a blank page, checks distinct document
  identities and fresh optimizer history, then checks the admitted recipe and
  actual replay. The original runner verdict and refusal are both retained.

## Verification

The corrected real-WebGPU acceptance passed all 15 gates on the Intel Xe2
adapter, with zero errors, readable error ledger and stable source hashes.
It evaluates the actual 96-cube and independently recounts raw voxel/grain
volumes. Castings reached .920123/.920076 solid at 41,776/51,936 delivered steps.
The winning shared recipe measures 18.6379694049 um and replays at 51,936 steps.
Speed 1 and 4 yield identical state and grain-ID SHA256 values. Nine actual
one-step invalid castings cross a CMA generation and cannot be applied/shared.

The run archive's six entries, checksums, two-row convergence CSV, metadata and
decoded 758 x 614 PNG are checked independently of the archive writer. Python's
zipfile and Pillow supply a second CRC/image check; the physics image area has
nonzero contrast independently of the footer. Archive SHA256:
`9b1a7d03a5a923d03e351e3f3b80184732ce507908c3f4e55e947cde3c8694d7`.

All 37 registered local scripts passed in one full run, including the legacy 2D
optimizer, rail, exports, fused/split solvers, quantitative regressions, composer,
experiments, heat treatment, scale and general 3D workflows. All 151 files under
`src`, `scripts` and `app` retained their freeze hashes. Default 2D optimizer
arithmetic and existing solver sources match the baseline after removing only
the declared API additions. Typecheck/build and all 21 browser-free CI scripts
pass: https://github.com/fronkt/solidify/actions/runs/41072120918.

The result UI and phone controls also passed independent visual/copy review:
the mean-volume equivalent sphere, census cutoff and qualitative model scope
are stated accurately. The default target is not guaranteed attainable. This
feature supports Kobayashi; calibrated 3D is visibly refused and its separate
literature-reference acceptance remains open.

Machine-readable evidence: [optimizer3d-2026-10-30.json](../validation/optimizer3d-2026-10-30.json).
