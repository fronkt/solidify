# Prospective four-arm equilibrium translation diagnostic

This dedicated diagnostic does not modify or complete the original fourteen-case
matrix. It cannot establish quantitative needle acceptance. Default execution runs
CPU controls only. `--run` explicitly starts the four GPU arms.

The arms cross epsilon0/.0171 with centerOffset `[0,0,0]`/`[.4,.4,.4]`, keeping
R20, n96, dx.8, lambda4, identity quaternions, default production pure3D equations
(`latticeKinetics=false`), the original dt formula, controlPeriod4, measurement
cadence20, and horizon1000. The translated arm uses its same-invocation baseline's
phase-volume feedback target. Radius and phase amplitude are unchanged.

One actual coordinate adapter applies
`x_local=(cell+.5-n/2)*dx-declaredCenterOffset` to initialization, centroid, and
surface points supplied to support fits. Raw integer cell indices and brackets
are retained alongside the recentered xyz coordinates and declared/applied offsets;
offline local-curvature replay must use those same recentered coordinates or
subtract the declared offset before reconstructing each original bracket. Never
remove observed centroid drift by changing the declared center. Existing callers
that omit centerOffset retain the old initialization arithmetic, zero-coordinate
identity path, default parameters and original raw schema.
In the explicit translation path only, exact half-phase grid-node roots are
retained as root0/root1; nonendpoint crossings use the original interpolator.
This handles reversed crossings ending exactly at psi=.5 without jittering the
field or dropping a surface point. Default surface extraction is unchanged.
Raw points mark endpointRoot and every measurement retains root0/root1 counts;
CPU controls explicitly exercise both crossing orientations and non-tie parity.

Initial actual full-volume phase readback must match the actual uploaded FP32
phase hash. A translated hash must differ from baseline; every centroid displacement
must exceed .2W0 and match .4W0 within .00008W0. The centroid through the exact
adapter used by the fitter must match zero within .00008W0. Initial relative
volume mismatch must be below the original 1e-4 volume guard. All these values
were frozen in the preceding CPU translation protocol, not chosen from GPU data.
Every checkpoint records centroid drift; a larger excursion makes the centered-pair
interpretation fail without suppressing its raw measurements.

At t0 of each translated GPU arm, an actual readback is measured again with the
shared fit/centroid adapter bypassed while the declared offset and phase stay
unchanged. That missing-recentering control must refuse. Missing translation is
also exercised by the CPU liveness controls. Raw evidence for the GPU negative
measurement is retained separately and never enters the equilibrium history.

The clock plan reproduces the original control loop, integer submission cap, and
sequential JS simulation-clock arithmetic. It requires each exact control count,
all 51 ordered measurement checkpoints, canonical `steps*dt` and actual uniform
`steps*Float32(dt)` clocks, and the original JS-defined fixed horizon. The epsilon0
50000-step endpoint has actual uniform time999.9999776482582; its deterministic
Float32 difference is reported, without adding a new physics step. No checkpoint is selected
by equilibrium or reference agreement. Source stability, a mandatory actual GPU
error ledger, hardware admission, readback/hash liveness, nonzero phase evolution,
and all device/browser/resource cleanup checks participate in the final verdict.
Fresh refused evidence replaces old verdicts before option or source validation.
No later cleanup error may leave a positive diagnostic verdict.

CPU controls verify original versus refactored full Float32 state/grain bytes,
explicit-zero parity, a known translated sphere through the actual adapter,
centroid and hash liveness, missing-offset and missing-recentering refusals,
exact clock plans and corrupted-clock refusals, and lifecycle failure refusals.

Run CPU controls:

```text
node scripts/research/quant3d-equilibrium-translation.mjs verify-out/q3-translation-cpu 5201 --self-test
```

With a separately running local Vite server on port5201, run the four GPU arms:

```text
node scripts/research/quant3d-equilibrium-translation.mjs verify-out/q3-translation-gpu 5201 --run
```

`translation-result.json` reports `completed` for execution evidence and
`diagnosticPassed` for the original equilibrium judge plus centroid checks.
`accepted`, `fullMatrixCompleted`, and `q3Accepted` always remain false.
Each raw checkpoint is gzip-retained with compressed/uncompressed hashes. Paired
support, temperature, epsilon and d0 differences are descriptive; no new physical
coefficient or accuracy band is inferred. The prior manufactured control covered
smooth known-geometry normal-distance profiles, and does not bound error for
evolved lattice-distorted profiles or selected needle sigma.
