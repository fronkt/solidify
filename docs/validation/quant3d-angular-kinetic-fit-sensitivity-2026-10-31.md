# Angular kinetic fit-sensitivity figure

Solid-side finite-range kinetic intercepts on the physical lattice; markers use the registered quadratic fit at V = 0.005, 0.01, 0.02. Bars show the full intercept range across the registered linear, primary quadratic, secondary quadratic and cubic methods; they are fit sensitivity, not statistical confidence intervals. V = 0.04 is held out from the primary fit and enters only the registered secondary/cubic sensitivity fits. Unit width, P.tau = 1, identity grain; [321] is the held-out orientation. These finite-range diagnostics establish no exact zero-speed coefficient, temporal stability, production adoption or Q3 acceptance.

Reproduce from the repository root:

```sh
python scripts/research/quant3d-oblique-kinetic-angular-plot.py
```

The CSV records every plotted primary value and each registered fit method. The JSON records input, source, environment and output hashes.
