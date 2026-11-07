# Independent assessment of the local finite-speed kinetic study

Read-only, 2026-10-30. Source pin eaed58c467410c36e814389bdcbe94384f08c82d. No shared source, research fixture, target, or GPU change was made. The recorded adapter is Intel xe-2lpg, nonfallback. Nine native cube hash pairs agree; sourceStable is true, errors are empty, all ten arms complete, and transverse variation is exactly zero. The three runtime production-shader hashes independently match the current exports; the older UI build label is not the shader identity.

All90 saved raw checkpoint hashes and clocks were independently checked. Final velocity and energy recomputed with accurate Python summation agree with the manifest within7.4e-15 and1.2e-12 respectively.

| Nominal dt | Mean V over four cell phases | Final phase RMS | Final T RMS | Energy error / latent growth |
|---:|---:|---:|---:|---:|
| .016 | .039998568–.039999798 | 1.80e-6–1.55e-5 | 3.00e-6–3.91e-6 | .00995–.01270% |
| .008 | .039992817–.039994517 | 6.02e-5–7.95e-5 | 1.81e-5–1.93e-5 | .08200–.08584% |

The target is V=.04W0/tau0. The speed error is .00050–.00358% at dt.016 and .01371–.01796% at dt.008. The phase-dependent speed spread is .00308% and .00425% of V respectively. Enlarging the normal domain1536→2048 changes mean V below1e-14; central residuals agree. The absolute one-dimensional heat ledger change, integral of delta(Ttilde-psi)dx per unit transverse area, is .000637–.005493W0. It is small relative to the6.4W0 latent-growth integral, but is measurable and larger at the smaller step. The Float32 uniform clock differs from nominal by only4.75e-8 fraction and cannot explain these discrepancies.

This is not a monotone time-convergence sequence. Additional CPU-only controls support a finite-precision explanation: Float32 Euler dt.016/.008/.004 gives relative V errors-7.27e-5/-1.49e-4/-3.10e-4 and heat-ledger drift.00346/.00692/.01144. Float64 Euler errors halve with the step and RK4 recovers the independent wave. Thus repeated Float32 rounding can dominate decreasing truncation error. This is evidence for a contributor, not proof of the exact WGSL/compiler arithmetic cause or a license to select the more favorable step as a converged answer.

The modal fits do NOT calibrate liquid-side beta. At40–56W0, the six-column liquid fit has normalized condition number about676 and an interface extrapolation L1 gain about262. Half-ULP perturbations of the recorded temperatures alone permit about4.7e-6 uncertainty in the extrapolated interface u, before model, velocity, or transient errors. The second complex-mode coefficients reach about151, compared with independent-wave coefficients near1e-8. Their basis is extremely small so these large coefficients can absorb quantization and profile mismatch while leaving a small local residual. Physical lattice sampling also aliases the reciprocal-lattice branches.

Changing windows and retaining zero/one/two complex modes changes uLiquid at phase0 over-.0005201 to-.0004846 for dt.016 and-.0005137 to-.0003372 for dt.008. Those variations far exceed the fit residual. A small residual, an apparently near-unit latent jump, or a numerically stable QR solve therefore does not establish an identifiable physical interface coefficient. Treat these as descriptive fits with unresolved extrapolation, not calibrated betaLiquid, zero kinetics, or evidence explaining the needle sigma miss.

This completed study supports production evolution of this particular finite-speed coupled profile with the reported precision and limitations. It does not establish zero-speed cancellation, all-orientation kinetics, time convergence at Float32 precision, or published needle acceptance. No scientific pass band was retrospectively added.

Reproduce the read-only audit with `python verify-out/q3-kinetic-local-assessment.py`; full window/mode sensitivity is in its JSON and concise ranges in `q3-kinetic-local-assessment-summary.json`. Additional CPU results are in `q3-kinetic-local-assessment-extra-cpu.json`. No GPU rerun was used.
