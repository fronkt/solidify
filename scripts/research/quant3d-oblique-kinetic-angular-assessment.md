# Angular kinetic candidate: completed CPU assessment

The prospectively fixed nodewise angular correction removes the observed
second-order oblique residual in this CPU study. Its primary finite-range
intercepts decrease by factors 16.28--16.37 from h=.4 to .2, including held-out
[321]. This supports the predicted fourth-order remainder. The experiment does
not identify an exact zero-speed coefficient, establish temporal stability,
implement production physics, or change Q3 acceptance.

All 87 fresh requests converged at the unchanged 3e-11 Newton criterion. The
48 preregistered baseline observations were reused with their raw hashes;
all 135 raw profiles verify. CPU sources and inputs remained stable. The
original 96-request study remains 95/96 and incomplete. Its literal [100],
h=.8,V=.04 principal-candidate residual remains 2.8642701849972338e-8,
above the unchanged criterion; the angular wrapper gives the same residual.
The new study records `q3Accepted=false` and
`adopted=false`.

## Model and prospective separation

The immutable protocol is `quant3d-oblique-kinetic-angular.md`. Parameters are
identity grain, nondimensional width1, lambda4, D2.5068, epsilon.0171. The full
sealed rational-plane source operator, free thermal far constant, selected
outgoing modal closure, metrology, and solver are unchanged. In particular,
the oblique spatial force retains the centered lab gradients, nodewise
anisotropy, grad(w).grad(q), and divergence of the tangential flux.

The added relaxation law is

```
r = (47/75)*lambda/D,
gammaFD = 16*epsilon*(S6FD-S4FD^2)/(3*aFD),
tauAngular = P.tau*r*[w - h^2*(1321/9870 + (1084/1645)*gammaFD)].
```

At every live node, `nFD=G_lab(q)/|G_lab(q)|`, `S4FD=sum(nFD_i^4)`, and
`S6FD=sum(nFD_i^6)`. The implementation uses the equivalent pairwise variance
to preserve exact principal zeros. It differentiates this expression and
chains its derivative through the actual centered-gradient matrices.
No geometric-normal constant replaces the live nodewise value. The literal
source cutoff has gamma and its derivative zero. The separate artificial
smooth flat-node fallback is explicitly fixed-normal and has derivative zero;
no differentiability of the full flux at zero gradient is claimed.

The added BVP residual and Jacobian are respectively
`V*deltaTau*q'` and
`V*[diag(deltaTau)*Dq + diag(q')*d(deltaTau)/dq]`.
Coefficients came from the independent analytic solvability derivation,
before candidate profiles. No profile or needle value selected a coefficient.
The default, earlier principal correction, and angular correction remain
separate models. [321] and V=.04 remain held out from the primary fit.

## Primary result and estimator uncertainty

The fixed primary estimator is the quadratic intercept of betaSolid(V) at
V=.005,.01,.02. The following values are finite-range intercepts, not direct
observations at V=0.

| Normal | h=.8 | h=.4 | h=.2 | .4/.2 ratio | Last observed order |
| --- | ---: | ---: | ---: | ---: | ---: |
| [210] | 8.7857227e-4 | 4.8486553e-5 | 2.9779976e-6 | 16.2816 | 4.0252 |
| [211] | 1.0068519e-3 | 5.4879454e-5 | 3.3517417e-6 | 16.3734 | 4.0333 |
| [321], held out | 9.4744216e-4 | 5.1859776e-5 | 3.1703025e-6 | 16.3580 | 4.0319 |

The coarse-to-medium ratios are 18.12--18.35. At h=.2 the corresponding
default intercepts are 1.2368e-3, 1.2516e-3, and 1.2425e-3; the earlier
principal-correction intercepts are 3.3888e-5, 3.3880e-5, and 2.4797e-5.
Thus the angular result addresses the oblique term missed by the principal
correction, while preserving exact principal equivalence.

All registered alternative fits remain in `summary.json`:

| Sensitivity over the nine angular groups | Solid | Liquid |
| --- | ---: | ---: |
| Linear/quadratic intercept spread | 1.35e-6--2.07e-6 | 2.54e-6--2.85e-6 |
| Secondary/primary quadratic spread | 1.74e-7--1.93e-7 | 2.44e-7--2.65e-7 |
| Four-point cubic/primary spread | 2.49e-8--2.76e-8 | 3.49e-8--3.79e-8 |
| Held-out V=.04 prediction error | 5.23e-7--5.80e-7 | 7.32e-7--7.96e-7 |

These are deterministic estimator sensitivities, not statistical confidence
intervals. The linear/quadratic spread is material relative to the finest
residual. No favorable estimator replaces the registered primary. The primary
solid/liquid intercept disagreement is at most 9.27e-9. Agreement of these two
bulk observables does not remove their shared finite-range extrapolation bias.
The h^4 trend supports cancellation in the tested range; it is not a universal
error bound or proof that an arbitrarily small V limit exists on the lattice.

## Independent controls and physical diagnostics

All prerequisite gates passed before profiles. Local gamma-gradient finite
differences give relative error 7.56e-11; the independent projected ambient
formula differs by at most 3.04e-17. Gamma agrees with the source-flux ratio
within 2.26e-17. The fixed-branch rational complex-chain check has maximum
relative error 4.30e-10; the full coupled BVP directional check is below
5.27e-9. Principal gamma, gamma Jacobian, and differences from the previous
candidate residual/Jacobian are exactly zero in the exercised controls.

Subtractive Float64 directional probes are weakly conditioned near flat
gradients. Their full step curves and the independent reviewer's initial
failed generic probe are retained. They were not used to widen a gate. The
reviewer's independent 70-digit local-gradient check gives relative errors
at most 1.05e-12 locally and 2.74e-10 after sparse chaining. The literal-flat
and explicitly artificial smooth-flat branches were checked separately.

Actual omission controls change tau by .00235--.00250 on the stored FP32
manufactured fields; using a geometric constant instead of the nodewise gamma
also changes tau. These checks discriminate the angular implementation even
when a broad one-step Euler tolerance could hide it. Actual WGSL gamma/tau
probes remain a separate hardware task.

All three normals have independent finest-grid controls. The maximum absolute
bulk-beta changes are:

| Control | Solid | Liquid |
| --- | ---: | ---: |
| Half-domain64 to96 | 2.82e-11 | 3.37e-10 |
| Sub16 to32 | 2.13e-11 | 1.12e-10 |
| Outgoing modes3 to2 | 2.12e-14 | 3.60e-12 |
| Tail-fit width4 to8 | 4.20e-14 | 1.96e-12 |
| Separate smooth/literal cutoff, all meshes | 6.20e-10 | 7.36e-10 |

These quantify the tested closure sensitivity, not an exhaustive oblique
characteristic spectrum. The signed whole-tau controls .9 and1.1 bracket
the nominal response for all normals. Their continuum beta is nonzero, and
their residual angular h^2 coefficient is
`(151/420)*(1-P.tau)*gamma/(sqrt(2)*a*D)`; they do not test zero-beta
cancellation away from P.tau1.

Across the 87 new profiles, q stays within [-1.000000000000007,
1.0000000000000069], maximum monotonicity violation is 6.88e-10, maximum
latent-jump error is 2.07e-11, projected residual is at most 1.52e-14, and
minimum local tau is .84892667. These diagnostics support the tested branch
but do not prove dynamical attraction.

## Seals, retained failure, and reproduction

The initial pre-output canonical seal is
`e820f93871d4eadab7c9b6e1d94bd7ca8825371c0b3025adb86688e1fc977410`
in `verify-out/q3-oblique-angular-study/prepare-seal.json`. It preceded the
manufactured angular packet and prerequisite outputs. The first execution
failed while serializing NumPy booleans after numerical prerequisites and
before any traveling profile. Its false initial result, log, exact sources,
and independently replayed prerequisite record remain intact.

Only two metadata boolean casts changed. No numerical expression, case,
criterion, fit, protocol, wrapper, or exporter changed. The amended seal
`1145cc49cb8a73ab7b3c57fb5bbb8fd12c8224a34447441f05081921444628eb`
in `verify-out/q3-oblique-angular-study-v2/prepare-seal.json` preceded all
87 fresh traveling profiles. The v2 packet's `protocol-amendment.json` records both versions
and the exact small diff. Do not describe the second seal as preceding the
earlier manufactured outputs.

Each canonical seal is SHA256 of its JSON object excluding `sealSha256`, with
sorted keys and compact comma/colon separators. Its hash differs from the
pretty-printed JSON file hash. Exact source copies accompany both seals.

Reproduce the amended execution and fixed assessment from the repository root:

```sh
python scripts/research/quant3d-oblique-kinetic-angular-study.py --out verify-out/q3-oblique-angular-study-reproduction --baseline-study verify-out/q3-oblique-coupled-study --fp32-inputs verify-out/q3-oblique-fp32-input-fixtures/operator-fp32-input-fixtures.json --prepare-only
python scripts/research/quant3d-oblique-kinetic-angular-study.py --out verify-out/q3-oblique-angular-study-reproduction --baseline-study verify-out/q3-oblique-coupled-study --fp32-inputs verify-out/q3-oblique-fp32-input-fixtures/operator-fp32-input-fixtures.json --run
python scripts/research/quant3d-oblique-kinetic-angular-summary.py --study verify-out/q3-oblique-angular-study-reproduction
```

Use a new output directory for independent reruns; the archived packet is
immutable. Existing-result reuse is part of the registered protocol, so
reproduction also requires the old study and its sealed profile files.

The completed `study.json` hash is
`8c6551259c7b849a564a97910d43576f535bfc5714e3fa5dbe75d5812fc84415`;
`summary.json` is
`89575bdf8040402669b4517d7ec0b831a1ccb319a2b7e4044b8fe3b781a068e2`.
Independent archival review replayed all135 raw bulk fits,27 fit groups,
21 control comparisons, held-out predictions, and signed response controls;
its separate report is under `verify-out/q3-angular-cpu-archive-audit/`.

## Separate post-study targets and remaining scope

The manufactured packet is
`verify-out/q3-oblique-angular-fixtures/angular-fp32-input-fixtures.json`,
SHA256 `75321b3f26491d1ac0f611ebc5228d3c0d346ad7af6458b3bcda89735b8d5a4c`.
It reuses the old 257-node stored psi/T/uniform inputs byte for byte, exports
full fields plus gamma and angular tau/RHS/Euler expectations, and does not
emulate intermediate WGSL rounding. Its first-seal provenance remains distinct
from the amended traveling-profile execution.

An optional post-study exporter, `quant3d-oblique-kinetic-angular-fronts.py`,
copies the already solved h=.8,V=.04 angular fronts for [210], [211], and
[321] to `verify-out/q3-oblique-angular-fronts/front-manifest.json`. It verifies
the original raw hashes and includes q/u values, Hermite interpolation
derivatives, the free thermal constant, configuration, measurements, and
diagnostic-only gamma/tau. Evolved dynamics must recompute gamma and tau from
the actual fields; the diagnostic arrays are not fixed physics. These fronts
and this results document were produced after the study and are outside its
pre-output seal and the immutable completed-phase ZIP.

The correction targets width1, identity grains, and P.tau1. Arbitrary rotations
require the lab-frame angular law; crystal-frame K alone is insufficient.
Other physical widths require consistent nondimensionalization. Coarse h=.8
still has a residual of order1e-3. Negative finite-speed beta values remain;
positive bare tau does not settle temporal stability. Principal equivalence
also means this angular term cannot repair the previous principal [100]
finite-speed heat-kick recovery failure or its literal-cutoff Newton failure.
Actual GPU Float32 parity, temporal conserved-enthalpy evolution, arbitrary
orientations, finite boundaries, and Q3 acceptance remain separate work.
