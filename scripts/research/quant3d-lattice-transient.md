# Independent coupled thermal-transient diagnosis

The frozen seven-arm recovery experiment remains refused. Its positive
temperature-kick arm exceeded the predeclared temperature-RMS band; this
diagnosis does not change its tolerance, target, parameters, time window or
verdict. The analytic relaxation remains an experimental candidate.

`quant3d-lattice-transient.py` independently evolves the principal [100]
phase/heat equations in Float64, with the physical lattice spacing retained.
It reproduces the frozen horizon and signed temperature perturbations without
opening a browser or importing/modifying the production WGSL or frozen driver.

## Exact-horizon independent calculation

For `q=2*psi-1`, `u=Ttilde-1`, `a=1.0171`, and the target's analytic relaxation,
the source-free laboratory equations used are

```
psi_t = {a^2 L_h psi + .5*[q-q^3-lambda*u*(1-q^2)^2]}/(a^2*tauScale),
Ttilde_t = D L_h Ttilde + psi_t.
```

The scalar cell-centered reflecting `L_h` is the exact [100] restriction of the
physical spatial stencil. This independent reduction does not reproduce GPU
operation rounding or production bulk-gradient cutoffs. It is therefore a
physics/discretization diagnostic, not a replacement for native GPU equivalence.

The calculation uses n=1536, h=.8, D=2.5068, lambda=4, epsilon=.0171,
tauScale=.9171496914311181, and actual local tau=.9487843946193335. Initialization
uses the independently solved Hermite target, rounded to Float32 and then
evolved entirely in Float64. The initial baseline and positive-kick arrays
match actual GPU initial arrays exactly. Coefficients are not fitted.

The three cohorts are baseline, `T += .002*exp[-x²/(2*4²)]`, and the same negative
kick. Phase initialization is identical. Explicit Euler applies the same phase
increment to the heat update, preserving discrete total enthalpy. The clock is
exactly 50136 steps times `Float32(.016)=.01600000075995922`, hence
802.1760381013155 tau. Sampling is reconstructed independently from the frozen
5D/V² protocol and checked against the optional actual GPU result.

Late velocity has a free intercept over the final eight cell periods. Phase
registration is bounded around observed mass position; its same shift is used
for temperature. The original fixed target and windows are retained.

| Calculation | Late V | Relative V error | Maximum late T RMS | Maximum late T error |
|---|---:|---:|---:|---:|
|GPU baseline|.1249877751|−.00978%|3.24136e-5|4.09960e-5|
|GPU positive kick|.1248628088|−.10975%|2.29677e-4|3.88485e-4|
|Float64 baseline|.1249694686|−.02443%|4.57517e-5|6.72660e-5|
|Float64 positive kick|.1248481792|−.12146%|2.47001e-4|4.18817e-4|
|Float64 negative kick|.1250907138|+.07257%|1.66180e-4|2.91091e-4|

The independent Float64 positive kick also fails the frozen `2e-4` RMS band.
Thus the observed response is not explained by a GPU-only rounding artifact.
Small baseline differences remain, and this comparison does not prove the
absence of every production discrepancy.

All 213 CPU initial/checkpoint NPZ hashes are checked by the tail audit. Float64
enthalpy drift is at most `7.9e-11`. The independently retained GPU raw fields,
their exact hashes, clocks and original verdict are observations, not fitted
CPU inputs. GPU data are optional for standalone CPU reproduction.

## Conserved heat and neutral translation

The conserved quantity is

```
E = integral(Ttilde-psi) dx,
dE/dt = D*integral(L_h Ttilde) dx = 0.
```

The positive kick adds approximately .0200529 per unit transverse area. A
neutral translation cannot absorb that excess: the far liquid and solid values
of `Ttilde-psi` coincide by the latent-jump identity. The enthalpy integral of
the translation mode is therefore zero.

The excess heat spreads and couples to phase advance. An uncoupled Gaussian
diffusion estimate alone misses the observed liquid residual substantially.
The full coupled solution is necessary; `5D/V²` was a nominal diffusion time,
not an established attraction or stability time for this wave family.

## Fixed-amplitude diffusion-length explanation

The outer liquid profile is approximately
`Ttilde=Tfar+A*exp(-V*xi/D)`. A measured speed perturbation predicts

```
deltaT(xi) ≈ -A*(xi/D)*exp(-V*xi/D)*deltaV,
peak near xi=D/V,
peak ≈ -A*deltaV/(e*V).
```

The observed GPU kick-minus-baseline speed is `deltaV=-1.2496633e-4`.
This predicts a liquid peak `3.68292e-4`; the aligned raw-field difference peaks
at `3.62573e-4`. The prediction uses measured speed and the independently solved
target amplitude, with no amplitude fit.

A second prediction uses the finite difference of the already frozen V=.1 and
.15 CPU thermal profiles, multiplied by that same observed deltaV. Its liquid
RMS error is `3.19e-6`, compared with an actual liquid difference RMS of
`3.31479e-4`. The corresponding Float64 prediction error is `2.45e-6`. An
uncoupled Gaussian estimate misses by about `3.08e-4` for the GPU response.

This explains why a roughly .1% velocity change passes the 1% speed clause but
fails the much more sensitive fixed-target temperature-profile clause. The
audit does not subtract this prediction from the original acceptance residual
or relabel the failed arm as passed.

## Stability inference: deliberately separate from evidence

The finite-speed bulk relation is `Delta(V)=1+betaS(V)*V`. Central differences
of the independently solved .1/.125/.15 waves give

| Relaxation | B=dDelta/dV near .125 |
|---|---:|
|Uncorrected|−.00531430|
|Analytic candidate|−.02280579|

Both branches have negative slope over this interval. Positive bare tau alone
does not establish attraction of the planar traveling wave.

For an idealized two-sided sharp-interface heat model, let a front perturbation
be `exp(sigma*t)`, and `S=sqrt(V²+4D*sigma)`. Linear heat matching and a local
kinetic slope B give, for the nontranslation root,

```
(S+V)*(1+B*S) = 2V,
sigma ≈ -B*V^3/D for small |B*V|.
```

This suggests a slow positive growth rate when B<0. The approximate e-fold
times are 241515 tau for uncorrected and 56279 tau for the candidate, or about
1505 and 351 thermal times. Five thermal times would not distinguish such a
mode from a slowly retained perturbation.

These are **sharp-interface inferences**, not measured finite-width lattice
eigenvalues. The actual waves have finite thermal jumps and lattice effects;
using their bulk slope in a common-interface-temperature model is an
approximation. The exact-horizon CPU calculation demonstrates the response and
failure, but neither proves asymptotic instability nor proves eventual recovery.
Finite-width spectral/domain controls would be needed for a stability claim.

The phase/heat setup and distinction between effective planar kinetics and
pinning follow [Karma and Rappel, PRE 57, 4323 (1998), Sec. VI.B.2](https://doi.org/10.1103/PhysRevE.57.4323).
The transient and stability calculations here are independent analyses for the
current stencil; no published coefficient is copied into it.

## A prospective discriminating test

A new test should compare independently predicted **responses**, rather than
assume every heat pulse returns to the identical wave after five diffusion
times. Before another GPU run, freeze CPU predictions and numerical controls
for held-out signed amplitudes ±.001 and a zero-integral perturbation such as
`.002*[exp(-x²/(2*4²))-.5*exp(-x²/(2*8²))]`. The latter separates conserved heat
from spatial thermal distortion; zero integral alone does not guarantee that
every slow mode is absent.

Use source-free evolution, unchanged coefficients, identical actual initial
fields, exact clocks, signed velocity contrasts, aligned thermal differences
and enthalpy checks. Set comparison uncertainties from independent CPU step,
domain and initialization controls before collecting those GPU data. Separately
test a finite-width eigenvalue or much longer signed evolution if attraction is
to be claimed. This would be a new experiment; it cannot repair the frozen
seven-arm refusal or establish Q3 needle acceptance retrospectively.

## Portable reproduction and provenance

From the validation worktree, with NumPy/SciPy installed:

```sh
python scripts/research/quant3d-lattice-transient.py --targets verify-out/q3-lattice-inputs/target-manifest.json --out verify-out/q3-lattice-transient
```

To include the retained actual GPU comparison:

```sh
python scripts/research/quant3d-lattice-transient.py --targets verify-out/q3-lattice-inputs/target-manifest.json --gpu-result verify-out/q3-lattice-study/lattice-kinetic-result.json --out verify-out/q3-lattice-transient
```

Outputs are `results.json`, 213 hashed NPZ checkpoints and `tail-audit.json`.
They record the running script hash, target/manifest hashes, optional actual GPU
result hash, dependency versions, actual parameters and exact clocks. Paired
uncorrected target files adjacent to the manifest are used only for the
explicitly labeled branch-slope inference, with their input hashes recorded.

The preserved original evidence uses GPU result SHA
`198a83ecdfc8fa31fec3b9393e52b8aabe1334286b098751a3a4acf5fceddea4` and corrected
.125 target SHA `90d61a0d15e708cec679b80ec9e8ab428d1540a3743723668fd8543ddb44c509`.
The earlier independent CPU script SHA is
`67405cdf8ffd2bc47225cbdd58c16359915c8aca3acbf9a331e5148e7b6a6157`; its result
SHA is `dcbde1189ac7e032da5bbb4ddd89231ce50feef0c3d8b806ce05069da4d5453e`.
Portable reruns record their own source/result/raw hashes rather than silently
reusing those earlier artifacts.
