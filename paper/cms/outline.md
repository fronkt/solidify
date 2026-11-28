# CMS paper outline (draft 1, 2026-11-27)

Working title: **Single precision is not the limiting error: a convergence and error-budget study of
three-dimensional dendrite tip selection with a WebGPU phase-field solver**

Venue: Computational Materials Science (fallback MSMSE). Author: Frank Cai (Purdue), as in the JME paper.
Separate from the JME paper (2D, qualitative, teaching; under review) and from a later software paper.

## One-paragraph claim

A thin-interface phase-field solver written in WGSL, which has no double precision, reproduces Karma and
Rappel's 1996 three-dimensional tip-selection results at two of their three anisotropies within a
pre-registered 10% budget (against their phase-field values), and the dominant errors are not precision.
An fp64 transliteration of the same discrete update shifts sigma* by 0.13%. The largest single effect is
the definition of the anisotropy strength: KR96's eps4 is grid-corrected, and at dx/W0 = 0.8 a raw eps4
is 2.9-3.6% weaker at equilibrium, which moves sigma* by 6.4%, more than every numerical control
combined. Width convergence is slow and linear in lambda, consistent with a residual interface-kinetic
error, so the sharp-interface limit is not pinned below about 5-17%. KR96's phase-field and solvability
values differ by 9-13%, comparable to our residual uncertainty, so the data cannot tell which of the two
the solver converges to. At eps4 = 0.0265 the refined run lies 5.8% below solvability and 16% below
KR96's phase-field value.

## Claims and evidence (every number from `paper/cms/scripts/ledger.py`)

| # | Claim | Evidence |
|---|---|---|
| C1 | fp32 rounding changes terminal sigma* by <= 0.13% (lambda 2.8) and every quantity by <= 0.05% (lambda 4) | fp64/fp32 port replays s2 (`quant3d-q3d-fp64-replay-s2`, `fp32port-replay-s2`) vs WebGPU replay (`q3c-narrow-ladder-replay`) |
| C2 | Same WGSL on Intel Arc 140V (laptop iGPU), RTX 5090 and L40S: anchor agrees to 0.03% | 11-07 replay (Arc) vs 11-24 replay (L40S); a11a814 RTX 5090 vs L40S near bit-exact (narrow-ladder md) |
| C3 | Pairwise controls at lambda 2.8 (raw 0.0171): domain 5e-7, dt/2 0.04%, width 1.7%, dx 0.6 3.2% in sigma* | Option B JSON |
| C4 | The same controls at lambda 4 also pass (max 3.5%) while sigma* is 16% below KR96 PF: pairwise rule != asymptotic convergence | five-arm a11a814 JSON |
| C5 | Width ladder lambda 5.0 -> 2.52 (7 points): sigma* +19%, V d0/D linear in lambda (rms 0.06% vs 0.2% quadratic); extrapolated sigma*(W0->0) +5% (quadratic) to +17% (linear) | 11-07, five-arm width, Option A, Option B width |
| C6 | Linear-in-lambda error is what a residual kinetic coefficient gives: beta V / (d0/rho) = 2 a2 delta lambda P | derivation (Discussion); check against the oblique-kinetics diagnostics |
| C7 | eps_eff/raw = 0.964-0.971 (dx 0.8), 0.982-0.983 (dx 0.6); R20 -> R30 <= 0.7%; one-step proportional calibration hits targets to <= 0.11% | equilibrium matrices s1-s3 |
| C8 | Matched anisotropy moves sigma* +6.4% at 0.0171 (prediction from KR96 slopes held to 0.7%) | e171cal vs w28; frozen prediction in protocol |
| C9 | Calibrated rows vs KR96 PF / solvability (sigma*): 0.0123 -0.6% / +8.8% (accepted PF); 0.0171 -3.8% / +4.9% (accepted PF); 0.0265 dx 0.8 -11.7% / -0.5% (budget 14.4%, not accepted); 0.0265 dx 0.6 -16.4% / -5.8% (not accepted) | rows s1-s3 |
| C10 | Raw-anisotropy agreement with solvability (w28 -1.4%, width arm +0.23%) is a cancellation between the weaker anisotropy and the width error | Option A/B vs e171cal |
| C11 | Execution is auditable: every checkpoint replayed on CPU, protocols frozen in git before each run, frozen predictions recorded | replay JSONs, protocol commits |

## Sections

1. Introduction: tip selection as the quantitative 3D benchmark; thin-interface PF; GPU PF
   (fp32 common, rarely tested); WebGPU (cross-vendor, browser, WGSL f32 only); question and
   contributions (C1, C7-C8, C5-C6, C9).
2. Model and numerical method
   2.1 Thin-interface model (KR98 constants a1, a2; lambda; d0, D, tau0; cubic a(n); tau(n))
   2.2 Discretization (19-point scalar Laplacian, variational anisotropic flux, explicit Euler,
       dt rule, lattice-kinetic correction), WGSL implementation, memory (61 B/voxel), split flux
   2.3 Geometry, initial and boundary conditions, sizing in diffusion lengths
   2.4 Tip metrology (local tip radius, V, P, sigma*), stationarity, uncertainty, drift, validity
       gates, acceptance budget; independent CPU replay
   2.5 Effective anisotropy from equilibrium shapes; calibration
   2.6 fp64 port
   2.7 Protocol: pre-registration, frozen predictions, chronology (what was not tuned)
3. Results
   3.1 Precision and portability (Table: WebGPU / fp32 port / fp64 port; GPUs)
   3.2 Numerical controls and the width ladder (Fig: sigma*, P, V vs lambda; Table controls)
   3.3 Effective anisotropy (Table / Fig)
   3.4 Comparison with KR96 at three anisotropies (Table; Fig sigma*(eps4) log-log)
   3.5 The strongest anisotropy: resolution
4. Discussion
   4.1 Error budget (Fig: bar chart of |delta sigma*| per factor)
   4.2 Why width convergence is linear (residual kinetics)
   4.3 Phase-field vs solvability references
   4.4 Practicality: run times, memory, laptop
   4.5 Limitations (one undercooling, octant symmetry, no noise, <100> aligned, one material class)
5. Conclusions
Statements: data/code availability (GitHub branch + Zenodo archive, to deposit), CRediT,
competing interests, AI-use declaration (Frank's wording), funding (none?), acknowledgements.

## Figures (all from archived data)

1. Tip surface patch and principal-plane profiles vs paraboloid (e171cal terminal checkpoint)
2. Approach to steady state: V, rho, sigma* vs time with the stationary window (e171cal, e265cal06)
3. Width ladder: sigma*, P, V d0/D vs lambda, with linear and quadratic fits and KR96 bands
4. Effective anisotropy ratio vs raw eps4 (dx 0.8 / 0.6, R20 / R30)
5. sigma* and P vs eps4: ours (raw, calibrated, dx 0.8 / 0.6) with KR96 PF and solvability
6. Error budget: |delta sigma*| per factor at eps4 0.0171

## Open for Frank

- Authorship and affiliation (default: sole author, Purdue, as JME).
- AI-use declaration wording (Elsevier requires one).
- Zenodo deposit of the raw checkpoint archives (DOI before submission).
