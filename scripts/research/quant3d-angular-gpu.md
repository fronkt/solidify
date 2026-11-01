# Prospective research-only angular GPU response

This study tests the separately derived local relaxation

```
tau = P.tau*(47/75)*lambda/D *
      [w/epsBar^2 - (1321/9870 + (1084/1645)*gammaFD)*h^2/epsBar^2],
gammaFD = dot(Apsi,nFD_lab^3)/(3*w*|grad_psi|).
```

Here Apsi and w are the existing production flux texture values, and nFD is
the actual centered laboratory-gradient normal. The literal flux cutoff sets
gamma to zero. The formula is restricted to the smooth cubic pure model,
single grain, unit quaternion, no noise or external program. The independent
symbolic derivation and bounds precede candidate data. No coefficient is fitted
to oblique kinetic observations or to the needle reference.

The separate rotated compensation proof is sealed in
`q3-rotated-compensation-independent-2026-10-31.zip`, SHA256
`0cc934d9a682ec1baaa177caf7c5fc70c91bd7a169c2db6efe7a24f693ef057f`.
It includes sixty literal rotated-stencil controls, thirty independent inner
quadratures and a global signed bound. The prior residual proof remains
immutable, SHA256`4640611714cd9d5cd57fe3c9d3a6629b3046c72e4ff6028f6a0e0e85e0aaf362`.

`quant3d-angular-shader.mjs` replaces only the exact existing experimental
principal-candidate local-tau block. Reversing that replacement must recover
the exact production shader. Production source files and application defaults
are unchanged. The rational-plane geometry adapter has its own separate exact
reverse proof and completed native-interior GPU controls.

Before GPU execution, freeze all candidate sources and the independent CPU
input artifact. Reuse exactly the previously registered 257-point periodic
Float32 psi/T fields and Float32 uniforms at dx=.8, dt=.004, epsilon=.0171,
lambda=4, D=2.5068, tau=epsBar=1. Evaluate all six normals100/110/111/210/211/321,
including321 held out. The CPU reference uses the actual nodewise FD normal,
not the declared geometric normal. It evaluates the Float32 inputs with
Float64 algebra; WGSL intermediate rounding/fusion is not emulated.

In a separate diagnostic kernel, capture the actual local tau and gamma before
evolution. Its reversible output adapter replaces only the reaction/Euler tail;
dispatch flux and phase capture only, with no heat pass or state advancement.
Compare tau at absolute tolerance2e-6 and gamma at2e-7. For each oblique normal,
the actual original principal-candidate capture must remain valid and fail the
angular tau comparison by more than ten tau tolerances. This omission control
makes the small angular term observable independently of an Euler response.
Capture is never substituted for actual field evolution.

Compare one actual Euler phase/temperature response and stored flux against
the independent CPU reference at the pre-existing absolute tolerance2e-6.
Require actual uploaded input bytes, geometry and local-tau round trips,
nontrivial phase evolution, finite/range-valid outputs, exact clocks,
non-fallback hardware, an empty readable device-error ledger, stable sources
and inputs, exact source copies, raw results and successful cleanup. Preserve
every refusal, including failed setup or comparison; do not change tolerances
after seeing output. Research execution is separate from capillary, kinetic
coefficient, stability, arbitrary-rotation GPU and Q3 acceptance.

The cancellation targets the zero-beta choice P.tau=1. Multiplying the full
corrected tau by an arbitrary positive t deliberately changes continuum beta
and leaves an angular h^2 contribution proportional to1-t. Signed tau controls
test that response; they do not assert the zero-beta cancellation for every t.
The registered zero-beta statement also assumes epsBar=1. For a physical width
W0 other than one with D held fixed, the continuum prefactor acquires W0^2;
the invariant's algebraic width cancellation alone does not justify reusing
the registered tau prefactor at another width.

Principal equivalence, signed tau, resolution scaling and cutoff sensitivity
belong to the separate preregistered CPU angular study. The original 95/96
coupled-study outcome and prior finite-speed thermal-recovery failure remain
unchanged. A successful manufactured response cannot establish temporal
stability or justify adopting this candidate in the application.
