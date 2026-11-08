# Quantitative 3D research diagnostics

These scripts investigate the unresolved quantitative 3D reference discrepancy.
They use the production WGSL without changing its coefficients. A completed
diagnostic is not acceptance of the selected needle state.

## Equilibrium matrix

Start Vite from the repository root on port 5199, then run:

```text
node scripts/research/quant3d-equilibrium.mjs verify-out/q3-equilibrium 5199
```

The optional fourth argument selects comma-separated names from
`quant3d-equilibrium-matrix.json`, for example `baseline` or
`baseline,half-dt,initial-shape`. The shape control requires the baseline in the
same invocation so that it inherits the measured initial phase volume. A
baseline selection runs both declared raw anisotropies.

The 14 predeclared cases separate mesh spacing, particle radius, time step and
initial shape. Every case runs its full fixed horizon with uniform-temperature
volume feedback. The original equilibrium stationarity/resolution checks remain;
effective anisotropy and scalar capillary length are reported independently.
Scalar capillary length is a diagnostic and has no fitted acceptance target.
This experiment does not measure moving-interface kinetics.

Results retain hardware identity, generated shader and file hashes, control
history, final verdicts, and compressed raw surface brackets with checksums. Use
one GPU owner and freeze all listed source/input files during each run. Set
`CHROME_PATH` and JSON-array `CHROME_ARGS` for a supported cloud graphics setup.

The first local baseline pair reached the fixed 1000 tau0 horizon with no device
errors: raw epsilon 0 measured -0.0001011133, while raw epsilon 0.0171 measured
0.0166019492. Both met the original equilibrium checks. These two observations do
not resolve the mesh/radius limit or justify a needle calibration coefficient.

## Finite-speed planar cross-check

See [quant3d-kinetic.md](quant3d-kinetic.md) for the independent coupled CPU
traveling profile, its exporter and physical-lattice controls, and the production
WebGPU comparison. The default command runs only a CPU metrology self-test;
`--run` explicitly starts the ten-arm GPU diagnostic. Its finite-speed comparison
does not establish a zero-speed kinetic coefficient or needle acceptance.

## Known-truth metrology controls

[quant3d-metrology-controls.md](quant3d-metrology-controls.md) describes a small
CPU-only experiment that challenges the unchanged estimator with independently
known curvatures. Its report preserves uncertainty undercoverage, including a
smooth falsely resolved example. Diagnostic completion is distinct from accuracy
acceptance; no estimator or threshold is changed by these controls.

## Forced-flow domain study (D3.4)

`flow-tip-tong.mjs` is the failed 11-01 FLOW-TIP-TONG comparison, kept as run.
`flow-domain.mjs` is the separately pre-registered follow-up (tasks/todo.md,
"D3.4 flow domain study - 2026-11-07"): box, inlet distance and half-width
varied at fixed lambda, arms in `flow-domain-arms.json`. With no option it runs
a CPU-only self-test (`flow-domain-selftest.mjs`, including the in-page driver
against a mock app); `--plan` prints the arms and GPU cost; `--run --port N`
needs a Vite server for this tree and writes `docs/validation/flow-domain-<date>.json`.
It never re-scores FLOW-TIP-TONG.

## Next Tong comparison (tong2)

`flow-tong2.mjs` is the separately pre-registered comparison that follows D3.4
and the D3.5 velocity inlet (tasks/todo.md, "Next Tong comparison", with its
amendment before any run): Tong et al. 2001 Table II at Tong's own lambda and
boxes in d0, tier P (dx 0.8 W0, the app's) and tier T (dx 0.4 W0, Tong's), a
stationarity clause and falsification arms at D2 tier P. Arms in
`flow-tong2-arms.json`; it reuses `flow-domain.mjs`'s arithmetic, in-page driver
and served-source metadata. With no option it runs a CPU-only self-test
(`flow-tong2-selftest.mjs`: the window table recomputed from its formula, the
verdict code on synthetic traces, the driver against a mock app, the
served-source admission, and the real Simulation on a recording GPU device at
every staged grid); `--plan` prints the arms and GPU cost; `--run --port N`
needs a Vite server for this tree, refuses unless the hashed files are clean
and src/ equals the head that passed the D3.5 GPU gates, and writes
`docs/validation/flow-tong2-<date>.json`. It never re-scores FLOW-TIP-TONG.

## Tong comparison 3 (tong3)

`flow-tong3.mjs` is the third, separately pre-registered comparison
(tasks/todo.md, "Tong comparison 3 (D2 only, far from the inlet)", with its
amendment before any run). It uses Tong's D2 row only, the one row inside the
solver's tau V / W <= 0.2 bound. Tier P is an inlet-distance ladder at n 1024
and dx 0.8 W0, with a convergence clause and the V and R bands (plus the
falsification arms) on the farthest arm; tier I is Tong's own geometry at dx
0.4 W0, information only. Arms are in `flow-tong3-arms.json`. It imports
`flow-tong2.mjs` unchanged (the file the tong2 GPU run froze) for staging, the
driver path, validity, falsification and admission. With no option it runs a
CPU-only self-test (`flow-tong3-selftest.mjs`); `--plan` prints the arms and GPU
cost; `--run --port N` needs a Vite server for this tree and writes
`docs/validation/flow-tong3-<date>.json`.

## Tong follow-up (ii): no-flow stationarity at D2

`flow-noflow-d2.mjs` follows tong3 (tasks/todo.md, "Tong follow-up (ii): no-flow
tip stationarity at D2", with its amendment before any run). Two no-flow arms
at tong3's tier-P staging run 81 chunks: N1024 and N2048, each with a centred
seed. Nested prefix windows (m 33 to 81) give STEADY or DRIFTING and m*.
N1024's first 33 chunks must replicate tong3's recorded no-flow speed. The two
boxes give the box rule, and R* is reported only when N1024 is STEADY; it never
re-scores tong3. A read-only probe records u ahead of the west tip. Arms are in
`flow-noflow-d2-arms.json`. It imports flow-domain, tong2 and tong3 unchanged;
the self-test checks that they equal their frozen heads. With no option it
runs a CPU-only self-test (`flow-noflow-d2-selftest.mjs`, which also drives the
real Simulation at n 2048 with flow off on a recording device). `--plan`
prints the arms and the GPU cost. `--run --port N` needs a Vite server for
this tree and writes `docs/validation/flow-noflow-d2-<date>.json`.

## Runner lifecycle controls

`node scripts/verify-quant3d-tip-lifecycle.mjs` runs the real benchmark CLI with a
synthetic CPU browser. It tests missing GPU error evidence, cleanup failures,
initialization and retry artifacts, late page errors, source changes, and subset
verdicts. These checks run in CI and never launch Chrome or execute GPU physics.
