# Prospective nodewise angular kinetic candidate: CPU protocol

This protocol is sealed before evaluating angular-candidate outputs. It does
not edit the existing operator, exporter, reference, original 96 requests,
95/96 result, failure criterion, physical parameters, estimator or Q3 gate.
The default, previous principal correction and angular correction remain
distinct models. No coefficient is selected from oblique data or needle values.

## Analytic candidate and exact nodewise implementation

All physical calculations use nondimensional epsBar=1, lambda=4, D=2.5068,
epsilon=.0171, identity quaternions and the full existing rational-plane spatial
operator. Let `g=G_lab q`, `nFD=g/|g|` and `aFD` be the source flux anisotropy.
For live identity-cubic nodes,

```
S4FD=sum(nFD_i^4), S6FD=sum(nFD_i^6),
gammaFD = 16*epsilon*(S6FD-S4FD²)/(3*aFD),
c_total = 1321/9870 + (1084/1645)*gammaFD,
r=(47/75)*lambda/D,
tauAngular = P.tau*r*[w-c_total*h²].
```

No declared geometric plane normal substitutes for nFD at a live node.
Gamma is also equal to the actual source-flux expression
`dot(Bq,nFD³)/(3*w*|Gq|)`, where `Bq=2*Apsi`, at epsBar=1. That equivalence is a
control. Nodewise normal changes with phase profile are retained.

The literal `|grad psi|²<1e-12` branch uses gamma=0 and dgamma/dq=0, matching
the source flux branch w=1,A=0. In the separately labeled optional smooth branch,
an exactly flat node inherits the sealed core's fixed geometric-normal fallback;
gamma has that geometric value and derivative0 there. No Frechet differentiability
at zero gradient is claimed for this artificial smooth fallback.

The stable real-algebra implementation computes

```
K = sum_{i<j} g_i²*g_j²*(g_i²-g_j²)²/(sum_i g_i²)^4,
gammaFD=(16*epsilon/3)*K/aFD.
```

This pairwise variance equals `S6FD-S4FD²` for the normalized gradient and gives
exact principal zeros without cancellation. The derivative is analytic:
differentiate the pairwise numerator and radial denominator, then include
the derivative of `1/aFD`. It is independently checked against finite differences
and the ambient normal-gradient formula projected by `(I-nFD*nFDᵀ)/|g|`.
The q Jacobian chains all three local gradient components through the existing
centered sparse `Gi` matrices.

The sealed previous-candidate BVP supplies every spatial, reaction and thermal
term. The new wrapper adds only

```
deltaTau = tauAngular-tauPrincipal,
deltaResidual = V*deltaTau*q',
deltaJacobian = V*[diag(deltaTau)*Dq + diag(q')*dDeltaTau/dq].
```

Endpoint phase constraints are unchanged. The free thermal far constant and
outgoing modal closure remain unchanged. Projected balances and local tau ranges
are recomputed using actual angular tau rather than copied from the old model.

The analytic h² cancellation targets P.tau=1 at registered nondimensional
epsBar=1. With the entire corrected tau multiplied by t, signed response
controls have nonzero continuum beta and residual angular h² coefficient
`(151/420)*(1-t)*gamma/(sqrt(2)*a*D)`. They test actual response/slope, not
zero-beta cancellation for t=.9 or1.1. Other-width flux-ratio checks are algebra
only; changing physical W0 at fixed D requires consistent nondimensionalization
or the appropriate P.tau scaling. Rotated-crystal generalization is outside this
identity-only wrapper; crystal-frame K alone is not a general lab-stencil law.

## Registered matrix and independent controls

The main comparison is three models × three normals (210,211, held-out321) ×
h=.8,.4,.2 × V=.005,.01,.02,.04: 108 main observations. The primary velocity
quadratic uses the first three speeds; .04 is held out. Linear/quadratic,
secondary-range quadratic and four-point cubic sensitivity remain visible.
No fit supplies a physical coefficient.

The exact 48 default/principal observations at h=.8/.4 are reused from the
sealed old study, with all original raw/source hashes and failures preserved.
They are copied into the new evidence packet without selecting favorable
cases. Fresh requests are:

- 36 angular main profiles across all three meshes, normals and four speeds.
- 24 default/principal h=.2 main profiles at the same fixed parameters.
- Six angular signed-tau controls at h=.4,V=.01,P.tau=.9/1.1.
- Twelve angular numerical controls at h=.2,V=.005: separately domain64→96,
  sub16→32, outgoing modes3→2 and tail fitting width4→8 delta, for every normal.
- Nine angular smooth-versus-literal cutoff controls at V=.005 for every mesh
  and normal. They are separate from the literal main matrix.

This is 87 fresh profiles plus48 reused observations. Default sub16, half64,
three outgoing modes, derivative order6/bias1 and tail width4 delta are unchanged.
[321] is held out from derivation/selection. Its observed behavior cannot change
the coefficient or primary fit window.

Before profiles, controls require:

- Actual-field gamma agrees with the direct source-flux expression within
  `2e-12` absolute on the existing 257-node stored-FP32 manufactured inputs.
- Independent local analytic gamma gradients agree with centered finite
  differences to relative `2e-7` on nondegenerate generic gradients.
- Restricted periodic gamma Jacobians agree with an independent rational complex
  continuation on the fixed active branch to relative `2e-6` (principal zeros
  use absolute `2e-12`), at complex step1e-30. The Float64 subtraction-probe curve
  at1e-3/1e-4/1e-5/1e-6 is retained as conditioning evidence, not used to choose
  a favorable derivative or widen a criterion. Independent70-digit local-G
  chain differentiation is an additional reviewer crosscheck.
- Full angular BVP Jacobians agree with independent directional differences to
  relative `1e-6`, for210/211/321 and literal/smooth branches.
- Principal residuals and Jacobians match the previous candidate within
  `2e-12` absolute at h=.8/.4, V=.04 and both cutoff policies. Stored principal
  smooth profiles remain solutions within the old solver criterion; the
  original literal100 failure is retained rather than claimed repaired.

No Newton tolerance is relaxed: `3e-11` maximum residual and the existing
iteration/line-search rules apply. Failed states/traces, q range, monotonicity,
solid/liquid disagreement, local tau positivity and numerical sensitivities are
retained. Completion is distinct from calibration or acceptance.

The primary scientific target is removal of the predicted oblique h² residual,
with remaining finite-range/mesh error and uncertainty reported. A fourth-order
trend alone is not a universal error bound. Solving an imposed-V branch is not
proof of temporal attraction or asymptotic stability. Prior recovery and Q3
refusals remain unchanged.

## Pre-output seal and reproduction

The study's prepare-only command writes all requests, reused-input hashes,
protocol/source hashes and exact source bytes before any angular calculation:

```sh
python scripts/research/quant3d-oblique-kinetic-angular-study.py --out verify-out/q3-oblique-angular-study --baseline-study verify-out/q3-oblique-coupled-study --fp32-inputs verify-out/q3-oblique-fp32-input-fixtures/operator-fp32-input-fixtures.json --prepare-only
```

Execution verifies that prepared source/input seal before controls or profiles:

```sh
python scripts/research/quant3d-oblique-kinetic-angular-study.py --out verify-out/q3-oblique-angular-study --baseline-study verify-out/q3-oblique-coupled-study --fp32-inputs verify-out/q3-oblique-fp32-input-fixtures/operator-fp32-input-fixtures.json --run
```

CPU imports and protocol are frozen. Baseline WGSL exact bytes/hashes are also
retained as provenance; this wrapper is not a production shader implementation.
Root owns any separate research WGSL adapter, source proof and hardware tests.

After the seal, the new FP32 packet can be exported without touching old inputs:

```sh
python scripts/research/quant3d-oblique-kinetic-angular-fixtures.py --inputs verify-out/q3-oblique-fp32-input-fixtures/operator-fp32-input-fixtures.json --out verify-out/q3-oblique-angular-fixtures
```

Its format is `solidify-oblique-angular-fp32-input-fixtures-v1`: unchanged stored
psi/T and uniforms; original full fields plus gammaFD; controls.Angular contains
tau, q/heat RHS and real/rounded Euler expectations. WGSL intermediate rounding
is not emulated. Actual GPU tau/gamma probes and an omission-negative control
are necessary because a broad Euler tolerance could hide a small tau term.

All scripts are CPU-only. An optional later results assessment is separate from
this immutable prospective protocol. No production, old reference or old
scientific artifact is changed by the experiment.
