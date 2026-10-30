# Independent quantitative 3D diagnostics, 2026-10-30

These investigations narrow the next experiment; they do not accept Q3. The
published tip bands, metrology, historical failures and prospectively fixed
terminal protocol are unchanged. No coefficient below was fitted to tip P or
sigma.

## Equilibrium capillarity

The audit replays all twelve previously completed equilibrium surfaces, verifies
their raw hashes and retains the existing metrology and fit orders. At radius20,
the effective anisotropy for input0.0171 is0.01660195,0.01680537 and0.0169613 at
dx0.8,0.6 and0.4. The corresponding effective d0 values are0.21820485,0.21935270
and0.22015546, compared with the continuum value0.220975. Mesh refinement reduces
both discrepancies. Halving dt or changing the initial shape has little effect.

An independent local axial-curvature reconstruction gives stiffness errors of
about-1.87%,-1.48% and-0.65% on those meshes; changing the local polynomial order
does not explain the earlier roughly18% selection-constant discrepancy. Coarse
dx0.8/radius40 behaves less cleanly and requires separate lattice-phase/radius
diagnostics. The two radius30/n144 cases await the aligned-reader rerun.

## Planar kinetics

Independent modified-equation derivation and exact symbolic integration give the
principal-plane candidate

\[
 \tau_{\rm loc}=\frac{47\lambda}{75D}
 \left[a(\mathbf n)^2-\frac{1321}{9870}(dx/W_0)^2\right]+O(dx^4).
\]

The derivation includes the discrete heat equation. Omitting its contribution
changes the coefficient incorrectly. Symbolic residuals vanish and independent
80-digit quadrature agrees in three translation gauges. This is a leading-order
principal-plane result: arbitrary-angle terms of order epsilon*dx^2, finite-speed
effects, Euler stepping, Float32 arithmetic and lattice pinning remain distinct.
It supplies no capillary retuning.

The unmodified coupled CPU moving-wave problem gives low-speed solid-side beta
intercepts0.00476503,0.00491116 and0.00498584 for100,110 and111 at dx0.4. A signed
relaxation matrix contains54 converged cases. Separate domain, resolution and
profile-cutoff controls are stable. A prospective99-case test of the analytic
candidate reduces the residual under each mesh halving by15.84-16.67 times across
the three normals, consistent with a fourth-order remainder. The uncorrected
leading error decreases about four times.

At production dx0.8, very-low-speed pinning prevents a literal zero-speed
calibration claim. Independently converged finite-speed targets at V0.1,0.125
and0.15 support an actual production-WGSL recovery experiment. Its coefficient
comes only from the formula above. Freely evolving perturbed fronts and an
intentionally wrong relaxation value must be tested before adoption. No
production equation changes are included in this diagnostic checkpoint.

## Tip metrology

A known-truth protocol was fixed before reading actual tips: implicit atanh
phase jets, three transverse orders and two axial interpolation orders. All1440
synthetic measurements are retained. The ordinary sphere/paraboloid controls
give radius errors at most0.015% for the higher orders; the published-anisotropy
Wulff controls give at most0.055%. A deliberate subwidth stress profile can still
produce percent-level error, so this is not a universal bound.

Fifty raw terminal samples from the earlier five-arm study reproduce the original
rho, V, P and sigma. Higher-order local jets change mean rho by-0.133% to+0.034%
and sigma by-0.070% to+0.267%. All six variants remain about1% from the original
means. These fields provide no evidence that broad curvature fitting explains
the earlier selection-constant miss. Compact unresolved perturbations demonstrate
that identical samples alone cannot establish an absolute curvature bound.

## Reproduction and preservation

The unpublished calibration evidence draft contains
`q3-independent-diagnostics-2026-10-30.zip` (43,420,507 bytes,208 members), SHA256
`30e4ec8ef6630d97908d4dc5e6b12214ab6e3ca8f5e2c69b07844dbff577b429`.
Every member size/hash and ZIP CRC was checked after packaging; GitHub's asset
digest matches the local archive. Its explicit whitelist contains reports,
independent derivations, generators, raw CPU solves, the fixed reference solver,
the metrology archive and a member manifest. Account and bootstrap data are
excluded. Full audit scripts and numerical tables are preserved there.

Evidence draft: <https://github.com/fronkt/solidify/releases/tag/untagged-4ff2f3cab68d844e3925>.

The required next evidence is the completed equilibrium matrix, a valid GPU
kinetic recovery/negative-control study, affected regressions if a correction is
adopted, and the complete fixed-terminal five-arm needle campaign. Q3 remains
open until all required gates pass.
