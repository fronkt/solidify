# Capillary response grid: completed twelve-case assessment

The finest physical grid has much smaller measured dependence of local capillary
response on lattice position. The remaining absolute bias and estimator
sensitivity still prevent treating these measurements as a calibration or a
bound on needle selection error. Q3 remains open.

The fixed protocol crosses physical h/W0=.8/.6/.4, raw epsilon=0/.0171 and
offsets 0/h/2 on all axes. Grids 96/128/192 share a 76.8-cubed physical box,
radius 20, lambda 4 and one physical phase-volume target 33923.7386779148.
Every case reaches its original fixed horizon under the registered integer,
JavaScript and Float32 clock rules. All twelve observations are stationary,
resolved and centered under their unchanged diagnostic criteria. Actual upload
and missing-recentering controls verify the declared lattice phases.

The frozen replay uses the same crossings, degree4/6/8 surface fits, windows,
six-face combination and extrapolation. The table reports the signed difference
in C100 error, offset h/2 minus offset0, in percentage points. Values are
observations at registered samples; no continuum extrapolation is fitted.

| h/W0 | epsilon | Sextic difference (pp) | Octic difference (pp) |
| --- | --- | --- | --- |
| .8 | 0 | -2.61205 | -2.37254 |
| .8 | .0171 | -0.15769 | -0.41104 |
| .6 | 0 | +0.23813 | +0.17028 |
| .6 | .0171 | +0.18868 | +0.21920 |
| .4 | 0 | -0.02890 | -0.02458 |
| .4 | .0171 | +0.01293 | +0.01321 |

At h=.4, signed octic errors are -0.32966/-0.35424% for isotropic
offset0/h/2, and -0.64709/-0.63388% for anisotropic offset0/h/2. Sextic
estimates agree closely there. The centered isotropic octic sequence is
+0.05348%, -0.72895%, -0.32966% at h=.8/.6/.4: the coarse near-zero value
is nonmonotone and cannot serve as accuracy evidence by itself. The phase
differences also change sign; the anisotropic sextic pair-gap magnitude increases
from h=.8 to .6 before shrinking at .4. The full four-policy spans and degree4 controls
remain in the figure and 144-row CSV; they are sensitivity measures, not
confidence intervals or certified error bars. Known smooth-sphere controls
test implementation and coordinates, not interpolation error in evolved fields.
At the finest grid, the largest same-degree departure of a registered crossing
variant from its primary estimate is 0.12533 percentage points. Close sextic/
octic agreement therefore does not exclude a common interpolation or model bias.

The run is pinned to 10fb837912870ff0af60d69cf7868c186ae1fa0e. All fourteen
startup/final source hashes match; all raw compressed/uncompressed hashes and
actual clocks are preserved. The nonfallback local Intel GPU has a readable,
empty device ledger. No cloud resources were rented for this campaign.

The runner omitted exact source copies at startup. During the still-active
source freeze, all fourteen current files matched their recorded startup hashes
and were copied. The source-capture ledger explicitly records
capturedAtStartup=false and 2026-11-01T00:55:04.039643+00:00; the run began
at 00:18:22.959Z. This is a verified later capture, not a startup capture.
The future-run source-copy fix is separate from the frozen run and replay.

Reproduction uses the original sources in the final shared archive, together
with all three mesh archives extracted into one directory. The replay command
and estimator freeze are in quant3d-capillary-grid.md and
quant3d-capillary-grid-replay.py. The separately prepared plot plan selects
both epsilon panels, both phases, sextic/octic markers and all four same-degree
policy spans before full replay. No endpoint, method, coefficient or ten-percent
published-reference band was selected or changed after seeing output.

The new angular kinetic candidate is assessed separately. Capillary refinement
does not repair the prior five-arm published-reference failure, establish
long-time stability, or justify promoting research physics into the application.
