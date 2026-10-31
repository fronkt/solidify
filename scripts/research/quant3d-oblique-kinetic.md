# Full rational-plane kinetic reference

This CPU reference restricts the actual pure, identity-cubic production stencil
to rational planes. It retains the centered laboratory gradient, nodewise
anisotropy, expanded `grad(w) dot grad(q)` term, tangential correction divergence,
literal bulk-gradient cutoff and local relaxation. A constant-a approximation
is not used for [210], [211] or held-out [321]. No physical coefficient is fitted
to these results or to the needle reference. The candidate stays experimental;
this investigation cannot close Q3.

The operator is `quant3d-oblique-kinetic.py`; the independent literal-source
oracle and manufactured controls are in `quant3d-oblique-kinetic-controls.py`.
The separate `...-reference.py` supplies the coupled traveling problem, and
`...-study.py` registers its complete case matrix before running it. The operator
is kept separate so GPU parity work can pin its source while CPU BVP work proceeds.

## Physical coordinate and scalar stencil

Let m be a primitive nonzero integer triple, `n=m/|m|`, physical cubic spacing h,
and `delta=h/|m|`. A field constant on rational planes has
`q(c)=Q(delta*m dot c)` and `u(c)=U(delta*m dot c)`. A lattice neighbor r therefore
shifts xi by exactly `delta*(m dot r)`.

In stored variables `psi=(q+1)/2`, `Ttilde=u+1`, the source quantitative scalar
Laplacian is

```
L19 f = [2 sum_faces f(c+r) + sum_edges f(c+r) - 24 f(c)]/(6 h²).
```

Integer neighbor aggregation is performed exactly, retaining all zero shifts.
Writing `L19 f=sum_{k>0} wk*[f(xi+k*delta)+f(xi-k*delta)-2f(xi)]/delta²`, the weights are:

| Plane | delta | Positive weights wk |
|---|---|---|
|100|h|1|
|110|h/sqrt(2)|8/12, 1/12|
|111|h/sqrt(3)|1/3, 1/6|
|210|h/sqrt(5)|5/30, 4/30, 1/30|
|211|h/sqrt(6)|6/36, 3/36, 2/36|
|321, held out|h/sqrt(14)|4/84, 3/84, 3/84, 1/84, 1/84|

The second and fourth integer moments verify respectively `L19→d_xi²` and
`L19=d_xi²+(h²/12)d_xi⁴+O(h⁴)` for every normal. Here the leading error uses the
physical h, not the normal-plane spacing delta.

## Exact centered gradient and anisotropic force

Define the laboratory centered differences

```
Gi q = [q(xi+m_i*delta)-q(xi-m_i*delta)]/(2h),
g = (Gx q,Gy q,Gz q), r=|g|, nFD=g/r,
S4FD=sum_i nFD_i^4,
a=1+epsilon*(4*S4FD-3),
t=16*epsilon*(nFD^3-S4FD*nFD),
w=epsBar²*a², B=epsBar²*a*r*t.
```

B is twice the correction A stored by the source flux shader, because g here
is the q gradient. The exact q-variable spatial force is

```
Fq = w*L19 q + sum_i (Gi w)*(Gi q) + sum_i Gi B_i.
```

Both the flux at a node and its divergence at neighboring nodes are evaluated
from the same underlying phase field. Constant-ghost boundaries therefore
extend q sufficiently far to construct the neighboring fluxes; they do not
simply set a flux ghost to zero. Periodic mode is provided for manufactured
quotient controls. It is not an infinite planar-front boundary condition.

The actual flux shader tests `|grad(psi)|²<1e-12`, hence `|g|²/4<1e-12` in q.
On that branch it writes `w=epsBar²,B=0`, including for anisotropic input.
This literal cutoff is enabled by default. `cutoff=False` selects the optional
smooth active branch for principal/formal algebraic controls. These branches
must not be silently interchanged.

At principal normals the active gradient components have equal nonzero
magnitudes, making t zero and a constant: the force then reduces to `a² L19 q`
at epsBar=1, reproducing the previous reference. In bulk nodes the literal source
cutoff uses w=1 instead; the previous reference used constant a² through those
tails. Principal active-branch parity and literal-cutoff differences are thus
reported separately.

At an oblique normal the finite differences have unequal physical shifts.
Their ratios depend on profile shape and position, so `nFD` is not the geometric
n. The full tangential and grad-w terms cannot be discarded.

## Local relaxation and coupled finite-speed equations

The default source relaxation is
`tau=P.tau*w/max(1e-20,epsBar²)`. The disabled-by-default experimental candidate is

```
tau = P.tau*(47/75)*lambda/D *
      [w/max(1e-20,epsBar²) - (1321/9870)*h²/max(1e-20,epsBar²)].
```

The candidate coefficient is the earlier principal-plane analytic prediction.
It is not adjusted for oblique observations. Both default and candidate tau
remain spatially varying through w; signed controls vary the explicit P.tau
input by .9 or 1.1 rather than recomputing the coefficient from a result.

For `xi=x-Vt`, qsolid=+1 on the left, qliquid=-1 on the right, the finite-speed
coupled problem is

```
Fq(q) + q-q³ - lambda*u*(1-q²)² + V*tau(q)*q' = 0,
D*L19 u + V*u' - V*q'/2 = 0.
```

The far liquid constant is a solved unknown. Integration requires
`u_liquid_far=u_solid_far-1`; independently fitted modal constants check that
identity without imposing it on the reported fits.

The spatial finite shifts stay fixed as a finer traveling interval eta refines
only q' and u'. Outgoing thermal characteristic roots satisfy
`D*sum_k wk*4*sinh²(k*delta*s/2)/delta²+V*s=0`. The retained modes approximate a
radiation closure; the implementation does not claim to retain every root of
the advance-delay problem. Domain, eta, mode count and modal fitting width are
varied independently.

The analytic Jacobian includes the derivatives of w and B through all centered
gradient components, plus `V*diag(tau)*Dq` and `V*diag(q')*dTau/dq`. A bare
constant-a Jacobian or omission of the latter local-tau derivative would solve
a different oblique problem. The cutoff is treated on its current active set;
its switching surfaces are nonsmooth, so failed Newton states and traces are
preserved rather than repaired by changing the cutoff.

The projected BVP balance retains `integral(Fq*q')` explicitly. The expanded
source stencil is not assumed to derive from a global discrete variational
energy, and a small projected residual is not a proof of that property.

## Meaningful operator controls

The independent oracle operates on stored psi, explicitly samples the six faces,
twelve edges and seven neighboring fluxes in three dimensions, and then converts
its force to q. It does not use the aggregate rational weights or sparse
implementation. For all six normals, force discrepancies are below `3.5e-15`.
The principal constant-a residual is below `3.3e-18`. Incorrect constant-a
oblique controls differ by `2.8e-5` to `1.28e-4` on the same manufactured field.

An independent reviewer also checked the nonperiodic constant-ghost extension
at boundary and central nodes, with maximum literal-oracle error `1.11e-14`.
Sparse spatial and w Jacobians have independent directional checks.

The original generic finite-difference Jacobian probe at step1e-6 failed its
strict numerical tolerance near very small gradients; that complete failure is
retained under `verify-out/q3-oblique-operator-controls`. The full step curve
shows truncation decreasing quadratically before cancellation dominates. A
bounded relative-gradient direction with fixed step1e-4 passes below `1e-8`.
The physical operator, coefficient and tolerance were not changed.

A literal-source manufactured refinement also verifies the independently
derived smooth-branch expansion

```
S4=sum n_i^4, S6=sum n_i^6,
C=(16*a*epsilon/3)*(S6-S4²),
Fq=a²*q''+h²*(a²/12+C)*q''''+O(h⁴).
```

The displayed remainder decreases approximately16-fold under h halving for
all six normals, including held-out321. This is a consistency check of the
full operator, not an oblique kinetic correction fitted from data. The
independent symbolic audit owns the expansion proof and solvability analysis.

## Prospective coupled study

The study artifact is written with all 96 requests before execution:

- Twelve principal cases pair smooth and literal-cutoff source behavior at
  h=.8,V=.04, default/candidate, with unchanged-reference solves for the smooth
  cases.
- Forty-eight physical cases cross210/211/held-out321, h=.8/.4,
  V=.005/.01/.02/.04 and default/candidate relaxation.
- Twenty-four separate fine-grid lowest-speed controls change domain64→96,
  sub16→32, outgoing modes3→2 or tail-fitting width4→8 delta.
- Twelve signed P.tau=.9/1.1 controls use h=.4,V=.01 on all three oblique normals
  and both relaxation variants.

The primary quadratic uses V=.005,.01,.02; .04 is held out. Linear versus
quadratic sensitivity is mandatory. These are finite-range diagnostic fits,
not proof of a literal V→0 coefficient or absence of pinning. [321] is not used
to select a formula or fit angular coefficients. Numerical differences and
every failure remain visible. Source hashes are checked before/after execution.

The initial literal210 h=.8,V=.04 pilot converged with Newton residual
`2.37e-11` and independent latent jump within `7.7e-14` of1. Its interface
finite-difference normal differed from the geometric normal by up to .0431 rad.
The pilot is not a calibration or a substitute for the registered controls.

## Registered results and pre-output prediction

The complete registered sequence executed, with **95/96 converged**, source
hashes stable, and `completed=false`. The literal [100] candidate at h=.8,V=.04
stalled in Newton's line search at `2.86427e-8`, above the unchanged `3e-11`
criterion. Its state and complete trace are retained; the smooth counterpart
does not replace this failure. Convergence of the other cases does not prove
uniqueness, stability, or that the failed nonsmooth problem has no solution.

All six smooth principal cases reproduce the unchanged reference: maximum q
difference `1.11e-15`, u difference `6.18e-13`, and betaS difference `4.30e-13`.
All six full coupled Jacobian controls pass at relative errors `4.6–5.3e-9`.
All 48 oblique physical cases, 24 numerical controls and 12 signed controls
converge. All 96 profile/failed-state hashes, six old-reference hashes and six
exported target hashes verify.

Before these oblique outputs, the independent auditor sealed the active-branch
solvability prediction

```
gamma = C/a² = 16*epsilon*(S6-S4²)/(3*a),
beta0_candidate/h² = 271*gamma/(525*sqrt(2)*a*D).
```

Its coefficients are .0007722562244 for210, .0007636229402 for211, and
.0005409923454 for held-out321. The sealed bundle hash is
`4640611714cd9d5cd57fe3c9d3a6629b3046c72e4ff6028f6a0e0e85e0aaf362`.
The formula predicts a nonzero oblique leading residual after the existing
principal correction; it is not selected from the following fits.

The primary solid-side finite-range intercepts are:

| Plane | h | Default | Existing candidate | Candidate leading prediction |
|---|---:|---:|---:|---:|
|210|.8|.0211395248|.0013737221|.0004942440|
|210|.4|.0049805924|.0001723282|.0001235610|
|211|.8|.0215228571|.0014871608|.0004887187|
|211|.4|.0050460087|.0001767496|.0001221797|
|321, held out|.8|.0213069354|.0012884848|.0003462351|
|321, held out|.4|.0050066571|.0001381949|.0000865588|

Candidate measured-minus-predicted residual divided by h⁴ is .00215/.00190
for210, .00244/.00213 for211, and .00230/.00202 for321 at h=.8/.4. This behavior
supports the leading prediction with higher-order corrections, but two meshes
do not establish an asymptotic bound. In particular,211 and321 have the same
S4=.5 and geometric a=.9829, but different S6. Their different measured residuals
are a meaningful held-out distinction that a constant-a or S4-only fit misses.

For candidate groups, linear versus primary-quadratic intercept sensitivity is
`1.36–1.97e-6`; changing the quadratic speed range shifts it `1.76–1.90e-7`, and
a four-point cubic shifts it `2.51–2.71e-8`. Held-out V=.04 solid-side prediction
errors are `5.27–5.69e-7`. These uncertainties remain separate from the formal
h expansion and from numerical solver sensitivity.

Largest solid-side domain/eta/mode/tail-width changes are respectively
`1.79e-11`, `1.32e-11`, `8.6e-15`, `4.2e-14`; liquid changes are at most
`1.03e-10`. All signed tau responses have the expected ordering. Among converged
profiles, q ranges from `-1.0000000000000016` to `1.0000000000000016`, and maximum
adjacent monotonicity violation is `1.53e-9`; these are retained, not rounded
away. Free latent-jump error is at most `6.33e-12`. Pure-oblique relative
cell-phase oscillation is at most `4.10e-7` at the tested finite speeds. The
solid modal fits remain well conditioned (at most1.13); liquid fits reach222.
No literal zero-speed or exhaustive-tail-spectrum claim follows.

A separately registered six-case extension compares smooth and literal
oblique cutoff behavior at h=.4,V=.005. All six converge; solid beta differences
are at most `1.85e-10`, liquid `2.45e-10`. This controls the tested cutoff
sensitivity without repairing or deleting the original [100] failure.
Artifacts are `q3-oblique-coupled-study/study.json`, `summary.json`, each raw
case/failed state, and the separate `q3-oblique-cutoff-controls/controls.json`.

## Reproduction and GPU fixture scope

CPU operator controls:

```sh
python scripts/research/quant3d-oblique-kinetic-controls.py --out verify-out/q3-oblique-operator-controls-v2
```

The original real-algebra manufactured fixture is immutable. A separate export
starts from actual Float32 stored psi/T and Float32 dx/dt/delta/D/lambda inputs:

```sh
python scripts/research/quant3d-oblique-kinetic-fp32-fixtures.py --out verify-out/q3-oblique-fp32-input-fixtures
```

Its reference evaluates those inputs in Float64, retaining real and rounded
Euler outputs. WGSL intermediate rounding/fusion is not emulated; root's
prospective2e-6 comparison bound applies. Operator quotient/native GPU execution,
source round-trip proof, nontrivial liveness and wrong-normal controls are
separate work owned by root.

A single CPU front or the complete registered study:

```sh
python scripts/research/quant3d-oblique-kinetic-reference.py --out verify-out/oblique210 --normal 210 --dx .8 --velocity .04
python scripts/research/quant3d-oblique-kinetic-study.py --out verify-out/q3-oblique-coupled-study
python scripts/research/quant3d-oblique-kinetic-summary.py --study verify-out/q3-oblique-coupled-study
python scripts/research/quant3d-oblique-kinetic-cutoff-controls.py --study verify-out/q3-oblique-coupled-study --out verify-out/q3-oblique-cutoff-controls
```

All programs are CPU-only. Inputs, environment, complete source hashes, solved
profiles, free constants, local tau ranges, outer fits/conditions and failed
states are retained. Actual production Euler evolution, Float32/compiler
effects, arbitrary crystal rotations, walls, alloy physics and temporal
stability are outside a converged traveling BVP. The earlier finite-speed
thermal-recovery refusal and Q3 literature failures remain unchanged.
