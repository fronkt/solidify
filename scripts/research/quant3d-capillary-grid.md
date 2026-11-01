# Prospective capillary grid-refinement diagnostic

`--grid-refinement` is an explicit twelve-case mode of the translation runner.
Omitting the flag preserves the existing four-arm protocol, result filename,
target pairing, tolerance values, and defaults. The old fourteen-case matrix
and runner are not changed. No mode establishes Q3 or needle acceptance.

The twelve cases cross dx.8/.6/.4, epsilon0/.0171, and offsets0/dx/2 on all
three axes. R20, physical box76.8, lambda4, default production pure3D equations,
identity quaternions, original dt formula, controlPeriod4, horizon1000 and
cadence20 remain fixed. Edges are n96/128/192. Names include dx, epsilon and
offset; only the complete distinct twelve-case set can complete this mode.
Baseline pairing uses dx+n+epsilon, never epsilon alone across meshes.

## One physical phase-volume target

Every case receives the prospective physical target
**33923.7386779148 W0^3**, with cell-count target `physicalVolume/dx^3`.
It is the Float32 phase integral of the finest-grid n192/dx.4/R20/offset0
canonical tanh sphere, chosen before evolved output. Its original phase SHA256
is `e792064d5695f1402a661cb48990d441e32eaa53874bfd24a419969cdcffcf6e`.
The defining accumulation is the driver's sequential JS Float64 sum of that
Float32 phase in z/y/x order, matching the volume controller. An independently
compensated sum can differ by small arithmetic roundoff; it does not redefine
this fixed target.
The numeric physical target stays fixed across hosts; local canonical integral
and hash are separately recorded and checked. No radius/amplitude adjustment
or mesh-specific fitted target is used.

An independent compensated Float64 midpoint sum uses a logistic formula,
sqrt radius and separately written physical coordinates. The radial moment is
`4*pi*R^3/3+2*pi^3*R/3`, up to a positive origin correction bounded by
`8*pi*(1/sqrt(2))^3*exp(-sqrt(2)*R)`. For a cube, omitted mass is bounded by
the exterior of its inscribed sphere: with `a=box/2-max(abs(offset))`, `k=sqrt(2)`,
the bound is `4*pi*exp(-k*(a-R))*(a^2/k+2*a/k^2+2/k^3)`.
All six mesh/offset initial fields are checked independently. The new1e-6
relative target-control tolerance and1e-10 local-canonical reproduction check
are CPU sanity checks, not physical calibration/uncertainty bands.

The existing .00008W0 centroid and1e-4 initial relative-volume guards are
unchanged. For the new meshes, initialization liveness requires each observed
half-cell shift to exceed dx/4 and match dx/2 within .00008W0. This preserves
the old .8 rule (.2 minimum displacement) and scales only the no-op detector.
Actual uploaded/readback hashes, same-mesh baseline identity, exact physical-to-
cell target conversion, centroid-through-the-fit-adapter, and missing-offset/
missing-recentering controls are mandatory. No existing failed gate is widened.

## Evidence and frozen replay

The same declared-center adapter is used for phase initialization, centroids,
and support-fit points. Original lab cells and brackets remain raw; xyz is
already recentered. The local-stiffness replay reconstructs independently from
lab cells, adds its crossing displacement, and subtracts appliedCenterOffset
exactly once. It verifies this frame against recorded xyz and refuses missing
or double offset. Observed centroid drift never changes the center.
Recorded versus independently reconstructed root differences remain descriptive:
an exact tangential double root has zero derivative and can amplify polynomial
roundoff beyond the nominal bisection width. No derivative-independent root
agreement band is imposed, and no original crossing function is altered.

The source-contained Python replay snapshots the previously audited crossing,
surface-fit, extrapolation and analyze functions. Only the known coordinate
adapter is inserted into analyze. Degrees4/6/8, transformed quintic primary,
transformed cubic/raw-phase/all-axis sensitivities, candidate fractions
.10/.12/.16/.20/.24/.28/.32R and extrapolation .12-.28R are unchanged.
Core function fingerprints and zero-offset analysis identity are checked.
Six full CPU sphere fixtures cover all meshes/phases and all six faces before
GPU data can be replayed. Known radius20 sanity remains1e-4 relative; it is
a CPU known-truth check, not an evolved-profile uncertainty bound.

Run CPU/default and12-case controls:

```text
node scripts/research/quant3d-equilibrium-translation.mjs verify-out/q3-capillary-grid-cpu 5201 --grid-refinement --self-test
node scripts/research/quant3d-capillary-grid-known-truth.mjs verify-out/q3-capillary-grid-known-truth
python scripts/research/quant3d-capillary-grid-replay.py --known-truth verify-out/q3-capillary-grid-known-truth/known-truth-manifest.json --out verify-out/q3-capillary-grid-replay
```

The last command validates known truth and writes a replay freeze before any
new evolved result is opened. Preserve that directory and the known-truth
fixtures. Source fingerprints retain raw, LF and CRLF representations; GPU
runtime byte hashes must match an explicitly frozen representation. This does
not replace source-stability checks or exact working-source preservation.

With a separately running Vite server on5201, root can launch:

```text
node scripts/research/quant3d-equilibrium-translation.mjs verify-out/q3-capillary-grid-gpu 5201 --grid-refinement --run
```

The result is `capillary-grid-result.json`, distinct from the old four-mode
`translation-result.json`. All51 checkpoints per case, exact integer/control
clocks, actual Float32 uniform clock differences, required hardware/ledger,
phase evolution, source stability and late cleanup checks remain mandatory.
Every raw sample retains compressed/uncompressed hashes and its physical/cell
target. The final gate requires all12 exact mesh identities and shared-target
conversion. `accepted`, `fullMatrixCompleted` and `q3Accepted` remain false.

After root confirms completion, replay the frozen study explicitly:

```text
python scripts/research/quant3d-capillary-grid-replay.py --known-truth verify-out/q3-capillary-grid-known-truth/known-truth-manifest.json --out verify-out/q3-capillary-grid-replay --result verify-out/q3-capillary-grid-gpu/capillary-grid-result.json
```

Report signed half-cell differences within each mesh and all fixed-order mesh
trends. Rank-dependent windows, lattice-profile interpolation and finite width
remain interpretation limits. No correction is selected from tip P/sigma,
reference tolerances are unchanged, and mesh convergence is not presumed.
