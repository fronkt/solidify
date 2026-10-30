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
