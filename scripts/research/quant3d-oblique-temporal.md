# CPU oblique temporal pilot, prospective protocol

This research-only pilot advances the full sealed rational-plane phase operator
in the laboratory frame. The selected traveling BVP imposes V=.04 only while
constructing the initial state. The evolution has no imposed translation speed.
It is descriptive finite-horizon evidence, with no recovery, speed-accuracy,
stability, production-GPU, or Q3-adoption acceptance band.

The prospective design and arithmetic derivation were reviewed before any
trajectory in `verify-out/q3-oblique-temporal-plan/plan.md` and `budget.md`.
Only this new Python entry point and this protocol are added. Existing phase,
angular-relaxation, reference, shader, and running capillary sources stay sealed.

## Inputs and equations

Fix m=(2,1,0), h=.8, epsBar=1, epsilon=.0171, lambda=4, D=2.5068, tauInput=1.
Use the existing converged literal-cutoff principal and angular BVPs at V=.04,
sub16, half64, three outgoing modes, order6/bias1. Their exact request and
raw/source hashes are checked. The old principal study's unrelated 100-cutoff
failure remains preserved; selecting a converged declared 210 case does not
change that study's verdict. No evolved needle measurement selects inputs.

The evolved quotient is the physical sub1 grid, delta=.8/sqrt(5). Initial core
samples coincide exactly with every sixteenth saved BVP node. Phase ranges are
validated without repair. Outside the actual saved BVP x extent, q is its
constant far state and u uses the existing fixed modal outer fit [40,56] W.
The saved [32,48] fit is a sensitivity check only. Join value/derivative,
alternative-tail difference and free latent jump must each be <=1e-8 before
evolution. Failed tails stop at preparation; no blend or refit is introduced.
The continuation retains selected outgoing modes, not the full infinite
boundary spectrum. Fixed cubic Hermite interpolation is used only for measuring
translated reference profiles, not for initial physical samples.

The actual phase equation is psiDot=(Fq+q-q^3-lambda*u*(1-q^2)^2)/(2*tau),
q=2*psi-1, u=T-1. Fq includes the full L19, centered-gradient normal, grad(w)
dot grad(q), and tangential-flux divergence terms. Principal tau is the sealed
1321/9870 candidate; angular tau additionally subtracts the sealed nodewise
1084/1645 gamma term. Both are explicit research choices, not adopted defaults.
The sealed literal small-gradient cutoff remains active.

Heat is a symmetric truncated graph with positive normal offsets 1,2,3 and
weights 1/6,2/15,1/30. The graph keeps a bond only when both endpoints are
inside the array. Each represented heat transfer is reused with opposite
signs. This is an artificial closed normal-end model, not the production
native wall or BVP outgoing end. Phase uses sealed constant ghosts. After
clamping the Euler phase to [0,1], heat receives the actual stored phase
increment. Clamps are counted. There is no energy projection.

Primary j=-358..1432 gives 1791 cells, approximately [-128.082,512.328]. The
wide control doubles both index bounds and retains identical central cells.
The tau lower bound uses the independently derived rigorous angular bound;
both heat monotonicity and the existing conservative phase timestep bounds
are required before execution. These are admission bounds, not a proof of
nonlinear stability. Float64 phase/temperature storage is explicit. No
Float32-storage trajectory or WGSL fused-arithmetic emulation is claimed.

## Fixed trajectories, clocks, and cost choice

The horizon is eight normal-cell periods, requested T=8*delta/.04, about
71.5542. Coarse dt=.004 runs 17889 steps to t=71.556. Half dt=.002 runs exactly
twice the steps. The 65 prospective coarse probe indices are
ceil(k*T/(64*.004)), k=0..64; half-dt indices are exactly doubled. All reported
times are integerStep*dt. This horizon is only about .04567 of D/V^2 and
cannot establish long-time recovery.

Each model has baseline and signed zero-integral thermal arms. With A=.001,
dT=+/-2*A*(G4-c*G8), c is the ratio of exact sums of the represented Gaussian
arrays. The actual injected discrete energy after adding to stored T is
retained exactly. No initial residual is removed. Psi is identical among
these arms. The two signs are separate nonlinear evolutions.

Before trajectories, benchmark 100 full RHS evaluations on unchanged inputs
for both models and both domains. Use three times max(wall,process) RHS cost
over all declared steps plus 120 seconds overhead. If option B is <=45 CPU
minutes, select B: both models, baseline/plus/minus at both dt, and both wide
baselines (14). Otherwise A is allowed only if <=45 minutes: angular's same
seven cases. Otherwise C performs no trajectory. This choice is sealed before
outputs. No optional net-heat or whole-wave translation trajectories are in
the initial batch. Those would require a new prospective extension.

## Exact energy and numerical evidence

At every probe compute exact represented E=Fraction(delta)*sum(T-psi-b),
using exact Fraction conversions before subtracting or serializing. Here b is
the fixed per-input far background. For unit roundoff u=2^-53 and
gamma_k=k*u/(1-k*u), the conservative one-step bound is

    delta * [gamma_6*2*sum_bonds(abs(F))
             +gamma_2*sum(abs(Told)+abs(H)+abs(dpsi))
             +u*sum(abs(psiOld)+abs(psiNew))].

The same represented bond numbers cancel in exact arithmetic; the bound covers
their at-most-six additions, two temperature additions, and rounded latent
subtraction. Positive reductions and running bounds are inflated/outward
rounded. The exact energy drift must fit the accumulated represented upper
bound. Nonzero subnormal intermediates in budgeted additions/subtractions are
refused. Heat-transfer underflow does not break pair cancellation; it remains
an evolution-accuracy effect. Known wrong-latent and unclamped-latent controls
must fail. No energy-correcting projection or temperature rescaling is used.

The formal continuous infinite wave has Ewave=D/V when its exact far enthalpy
states coincide. Report this identity separately from the finite BVP
quadrature, discrete finite-box sum, actual pulse energy and boundary effects.
D/E predicts a speed only conditionally on an isolated final wave carrying
all excess energy with no residual radiation. No such condition is assumed.
Adding net heat would have no predicate of returning to the same wave.

## Measurements, provenance, and completion

Retain actual x/psi/T and exact integer clocks at all 65 probes, raw and array
hashes, exact energy, arithmetic budget, range, clamp, cutoff/tau diagnostics,
and core clearance. Compare raw profiles with the imposed-V reference, and
independently measure displacement from phase mass and phase-only registration.
Registration has a fixed mass-centered +/-delta search, 48 golden iterations,
phase window +/-12 W and T window +/-24 W. Apply the same shift to temperature.
An endpoint optimum refuses measurement; the search is not expanded. Synthetic
neutral shifts, changed speed and temperature-only displacement controls run
before trajectories. Report free-intercept speeds over the full horizon and
the last two cell periods descriptively. Record signed odd/even perturbation
responses, matched-time dt differences and baseline-wide-domain differences.

Preparation seals source snapshots, exact input requests/hashes, controls,
contract, clock arrays and the benchmark-selected cases before trajectories.
Execution requires the exact root-reviewed pushed commit and unchanged sealed
CPU runtime bytes. Each prospective source record includes the canonical LF
Git blob SHA256/object ID and either exact or uniform LF-to-CRLF representation.
The committed blob must reconstruct the original sealed runtime and snapshot
bytes exactly by only that declared transformation. Bare CR, mixed newlines,
and any other content transformation are refused; old CRLF sources are not
rewritten. Actual Git/runtime admission evidence is saved before trajectories.
Fresh refused results precede CLI/model preflight. Every raw state
and failure remains under its new ignored output directory. Any numerical,
clock, input/source, exact-budget or lifecycle fault leaves completed false and
exit1. All declared trajectories/65 samples and comparison artifacts are needed
for completed true. Accepted, adopted and q3Accepted remain false even when
this finite-horizon diagnostic completes successfully.

Example, after root review and push:

    python scripts/research/quant3d-oblique-temporal.py prepare --out verify-out/q3-oblique-temporal-pilot-v1
    python scripts/research/quant3d-oblique-temporal.py run --out verify-out/q3-oblique-temporal-pilot-v1 --seal-sha <SHA> --expected-commit <pushed-commit>
