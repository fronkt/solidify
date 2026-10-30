# Analytic principal-plane lattice kinetics and frozen recovery experiment

This research protocol tests a prediction from the spatial stencil, independently
of the needle result. It changes the research driver's uniform `tau` input and
reuses the production WGSL equations. Production defaults and the Q3 literature
gate are unchanged. A successful run establishes finite-speed [100] dynamics
only. It does not establish zero-speed kinetics, arbitrary-angle calibration,
surface-energy calibration, or Q3 needle acceptance.

The implementation files are `quant3d-lattice-kinetic-targets.py`,
`quant3d-lattice-kinetic-driver.mjs` and `quant3d-lattice-kinetic-gpu.mjs`.
The target generator imports the existing CPU reference without modifying it.
All coefficients below are analytic; none is fitted to needle observations.

## Signs and solvability identity

Use `q=2*psi-1`, `u=Ttilde-1`, solid `q=+1` at negative x, liquid `q=-1` at
positive x, and the growth coordinate `xi=x-V*t`, with `V>0`. On a principal
plane with interface factor `a`, the exact spatially shifted equations are

```
a^2 L_h q + q-q^3 - lambda*u*(1-q^2)^2 + tau*V*q' = 0,
D L_h u + V*u' - V*q'/2 = 0,
tau = a^2 * tauScale.
```

Integration of the heat equation gives
`u_liquid_far=u_solid_far-1` for constant remote states and vanishing flux.
The numerical reference solves the liquid constant freely; its latent jump is
a control, rather than an imposed identity used to validate itself.

Self-adjoint spatial shifts on the full continuous translation coordinate give
`integral((L_h q)*q')=0`. The double-well term also integrates to zero. Thus

```
I = integral(q'^2), J = integral(q'*(1-q^2)^2) = -16/15,
tau*V*I = lambda*integral(u*q'*(1-q^2)^2),
betaS = -u_solid/V
      = -tau*I/(lambda*J)
        + integral((u-u_solid)*q'*(1-q^2)^2)/(V*J).
```

The positive bare-relaxation term and negative thermal term can therefore be
evaluated without a liquid extrapolation. At finite V, the solid and liquid
outer temperatures need not define the same apparent coefficient.

## Modified-equation derivation

Here `h=dx/W0` is the physical cubic-grid spacing. The restricted production
19-point Laplacian in all three principal directions has

```
L_h = d_xx + (h^2/12)*d_xxxx + O(h^4).
```

For [110]/[111], the actual normal-plane spacing is `h/sqrt(2)` or `h/sqrt(3)`;
substituting that spacing into the correction would be wrong. The symmetric
anisotropy-flux components vanish on these exact principal planes.

Set `z=x/(sqrt(2)*a)`, `t=tanh(z)`, `s=sech(z)`, and `eta=h^2/a^2`. The static
profile and its translation-invariant integral are

```
q = -t + eta*(z/12-t/6)*s^2 + O(eta^2),
I = [4/3+eta/15]/(sqrt(2)*a) + O(eta^2).
```

Substitution verifies the linear profile equation
`(.5*d_zz+1-3*t^2)*q2 = -q0''''/48`. A multiple of the translation mode can be
added to `q2` without changing the projected result.

At first order in speed, write `u=u_solid+V*theta`. Then
`D*L_h theta=q'/2`. Expressing the thermal solution in the corrected q coordinate
gives

```
theta(q) = a/(sqrt(2)*D) * {
  log((1+q)/2)
  + eta*[log((1+q)/2)/12 + 1/8-q/6+q^2/24]
} + O(eta^2).
```

With normalized weight `(1-q^2)^2` on `[-1,1]`, the exact moments are
`<log((1+q)/2)>=-47/60`, `<q>=0`, and `<q^2>=1/7`. Hence the first correction is

```
-47/720 + 1/8 + 1/168 = 331/5040.
```

The heat inverse operator contributes `180/5040`; the phase-profile change
contributes `151/5040`. Their sum is required. With
`A1e=5*sqrt(2)/8` and `A2e=47/75`, projection gives

```
beta0(h,a) = A1e*a/lambda * (tauScale-A2e*lambda/D)
  + (h^2/a)*[tauScale*A1e/(20*lambda)+331/(5040*sqrt(2)*D)]
  + O(h^4).
```

Let `r=A2e*lambda/D`. Canceling the displayed orders gives the frozen prediction

```
tauScale = r * [1-(1321/9870)*h^2/a^2],
tau(n)   = r*a(n)^2 - r*(1321/9870)*h^2,
1321/9870 = 1/20 + 331/3948 = .13383991894630193.
```

This is an isotropic additive shift in actual principal-plane relaxation. The
declared `D=.6267*lambda` slightly rounds the exact `47/75`; keeping actual D in
r accounts for the rounding without changing D or lambda. With `lambda=4`,
`D=2.5068`, `epsilon=.0171`, `h=.8`, and `a100=1.0171`, the predicted [100]
uniform factor is **`.9171496914311181`**.

These are new calculations for this stencil. The methodological distinction
between smooth-drift lattice kinetics, pinning and surface energy follows
[Karma and Rappel, PRE 57, 4323 (1998), Sec. VI.B.2, Eqs. 111–115](https://doi.org/10.1103/PhysRevE.57.4323).
Its numerical calibration coefficients are not copied into this stencil.

## Independent CPU validation and its limits

The preregistered 99-case CPU matrix pairs nominal and analytic relaxation at
`h=.1,.2,.4`, `V=.0025,.005,.01,.02`, and normals [100]/[110]/[111]. The primary
quadratic uses the first three speeds, holding .02 out. [111] is held out from
coefficient selection. Domain length, outgoing-mode count and traveling-coordinate
interval are varied separately at the lowest speed for every h and normal.

All 99 profiles converged and their raw/source hashes were verified. Primary
solid-side intercepts were:

| Normal | h | Nominal | Analytic prediction |
|---|---:|---:|---:|
|100|.4|.0047650041|6.37476e-5|
|100|.2|.0011811033|3.82305e-6|
|100|.1|.0003031001|2.39838e-7|
|110|.4|.0049111346|4.46074e-5|
|110|.2|.0012203024|2.71360e-6|
|110|.1|.0003127619|1.71309e-7|
|111, held out|.4|.0049858189|6.12814e-5|
|111, held out|.2|.0012353570|3.68725e-6|
|111, held out|.1|.0003162239|2.31051e-7|

Nominal residuals refine by approximately 4x; corrected residuals by
15.84–16.67x. Solid numerical-control differences are at most `2.28e-11`, phase
projection residuals `2.72e-12`, and free latent-jump error `2.10e-10`. Changing
the quadratic speed range shifts corrected intercepts by `2.04–2.53e-8`; a
four-point cubic shifts them by `2.92–3.61e-9`. Linear versus quadratic
sensitivity is larger, `4.39–5.43e-7`, exceeding the finest corrected residual.
The leading cancellation is supported; a model-independent sign for that
finest intercept is not established.

At production h=.8, the analytically corrected low-speed cell-phase oscillation
increases from .95% at V=.02 to 3.18% at V=.0025. Solid and liquid diagnostic
intercepts disagree, and speed-range sensitivity remains. Therefore a literal
coarse-grid `beta0=0` claim is refused. At h=.4,V=.0025, [100] oscillation is
`1.85e-8` relative; the practical fine-grid window is much better resolved.
No finite-grid pinning threshold was measured.

The constant-normal modified surface energy also fails to predict the global
Wulff anisotropy of the expanded flux stencil. This derivation does not justify
a capillary retuning or an arbitrary-angle kinetic law. The held-out [111]
test covers one additional symmetric plane only.

## Frozen production-WGSL experiment

The following protocol and tolerances are fixed before GPU results. All runs
use [1536,8,8], dx=.8, the target's explicit JSON profile and uniform transverse
planes. No profile is fitted to production output.

| Arm | V | dt | Initial perturbation | Uniform tau |
|---|---:|---:|---|---:|
|v-0.1|.1|.016|none|analytic|
|v-0.125|.125|.016|none|analytic|
|v-0.15|.15|.016|none|analytic|
|v-0.125-width-1.1|.125|.016|q(x/1.1), T unchanged|analytic|
|v-0.125-temperature-kick|.125|.016|T += .002 exp(-x²/(2*4²))|analytic|
|v-0.125-dt-0.008|.125|.008|none|analytic|
|v-0.125-wrong-tau|.125|.016|same corrected target|1|

Each positive arm runs at least `5D/V²`: approximately 1253.4, 802.176 and
557.067 tau for the three speeds. Terminal steps are rounded upward using the
actual Float32 uniform dt. The wrong-tau arm has the same duration as .125.
The first eight-step response and intermediate samples are retained. The final
eight cell periods have eight samples per period, including both endpoints.

Velocity is the slope of late mass position with a free intercept. Waveforms
are aligned to observed mass position with a bounded local phase registration;
permanent neutral translation after a perturbation is allowed. The frozen
positive clauses are:

- Relative late velocity error at most 1%.
- Aligned psi RMS at most .002 and maximum at most .01 within ±12 W0.
- Aligned T RMS at most .0002 and maximum at most .001 within ±24 W0.
- Exact terminal clocks, positive motion, finite bounded fields, exact plane
  symmetry, valid GPU diagnostics, stable source/input hashes and clean lifecycle.

Maxima over all late samples are used; a favorable endpoint is not selected.
The smaller-dt arm must meet the same clauses and its changes are reported.
The wrong-tau arm must maintain a valid backend while rejecting a target-specific
response clause. Its first-eight-step response must differ by at least 3% of V
from the unperturbed analytic .125 arm. The expected initial mobility contrast
is about 8.3%; a parameter-label mismatch alone cannot pass the control. The
verdict separately reports late-target rejection and an early-only rejection.
If only the early response fails, this is a mobility-response control, not
evidence that corrected tau is uniquely necessary for late recovery.

Actual initial GPU fields must also demonstrate perturbation liveness: the
width arm starts above .01 aligned phase maximum error, and the temperature
kick starts above .001 temperature maximum error. Exact declared sample-step
arrays are mandatory. CPU controls detect missing perturbations and a missing
declared sample before any GPU run.

Before any long domain, the specialized driver must reproduce all nine native
production state/grain/age byte hashes at steps 1,17,64 and show nonzero state
evolution. All line profiles are saved with hashes, together with exact clocks,
GPU metadata, production/specialized shader hashes, field censuses and errors.
The terminal full-state hash must match the state reconstructed from the raw
line and its exact transverse symmetry; full grain/age hashes are also saved.
Acceptance is assigned only after fixture/device/browser cleanup, mandatory
error-ledger readback, and final source/input verification.

Negative finite-speed betaS is not itself negative local mobility: actual tau
remains positive, while thermal finite-width terms shift the outer temperatures.
Nevertheless dynamic recovery is required. The production diagnostic checks
its local phase CFL using the actual uniform tau. Any future production formula
must also update host minimum-relaxation/CFL reasoning. The angular minimum
`a_min=1-5*epsilon/3` keeps `r*a_min²-r*(1321/9870)*h²` positive here, but this
does not establish stability or calibration at arbitrary angles.

Initializing a solved bulk constant and reading it back alone is insufficient.
The long source-free recovery, measured wave speed, shape, energy record and
actual wrong-tau response test are needed to distinguish dynamics from initial
data. A boundary-temperature feedback experiment would need the feedback to
stop, followed by source-free evolution; a uniform evolving temperature offset
would otherwise add a heat source.

## Reproduction

Generate explicit ignored inputs and CPU controls from the unchanged reference:

```sh
python scripts/research/quant3d-lattice-kinetic-targets.py --out verify-out/q3-lattice-inputs
```

Reproduce the 99-case analytic prediction matrix independently:

```sh
python scripts/research/quant3d-lattice-kinetic-targets.py --out verify-out/q3-lattice-cpu-matrix --matrix
```

Validate target checksums and CPU metrology without opening a browser:

```sh
node scripts/research/quant3d-lattice-kinetic-gpu.mjs verify-out/q3-lattice-study 5209 --targets=verify-out/q3-lattice-inputs/target-manifest.json --self-test
```

Only the explicit `--run` option launches the experiment. Use an already running
dev server and freeze all imported files before execution:

```sh
node scripts/research/quant3d-lattice-kinetic-gpu.mjs verify-out/q3-lattice-study 5209 --targets=verify-out/q3-lattice-inputs/target-manifest.json --run
```

`CHROME_PATH` and a JSON string array in `CHROME_ARGS` select the browser/backend.
A scientific discrepancy is retained and exits nonzero. It is not repaired by
changing a coefficient, tolerance or velocity window after seeing the data.
