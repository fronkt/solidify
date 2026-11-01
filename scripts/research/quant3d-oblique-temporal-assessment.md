# Oblique temporal pilot: conserved finite-horizon evolution

The prospective CPU pilot completed all 14 selected trajectories and passed an
independent replay audit. It tests actual laboratory-frame evolution from the
sealed finite-speed traveling references. No speed is imposed during evolution.
This is finite-horizon numerical evidence for the research principal and
angular relaxation candidates; neither candidate is adopted, and this study
does not accept Q3 or establish nonlinear asymptotic stability.

## Frozen design and actual execution

The source, protocol and v4 descriptor were pushed at commit
`6d409780576a937af64e6817199fb6341f9088c3` before trajectories. All six actual
CPU sources were admitted against that commit and the exact prospective
runtime snapshots. The old reference retained its original 311 CRLF lines;
its canonical LF Git blob was required to reconstruct those exact sealed
runtime bytes. No equations, coefficients, selectors, clocks, measurement
windows or criteria changed during execution. Earlier v1-v3 preparations
remain preserved with zero trajectories.

The identity-grain 210 plane uses h=.8, physical normal spacing
delta=.8/sqrt(5), epsBar=1, epsilon=.0171, lambda=4, D=2.5068 and tauInput=1.
The initial principal/angular BVPs have imposed V=.04, refined sub16 sampling
and the literal small-gradient cutoff. Physical sub1 initial samples coincide
with saved BVP nodes. Fixed, already-declared selected-mode tail continuation
extends outside the actual saved BVP interval; no new tail fit or phase repair
is selected from evolved data.

Each model has baseline and signed zero-integral thermal perturbations at
dt=.004 and .002, plus one baseline on the doubled domain. The heat pulse is
plus/minus 2*.001*(G4-c*G8), with c determined by the represented Gaussian sums.
The actual injected energy, about 3e-16 after storing the pulse, is retained.
No residual is removed. All 14 trajectories reach t=71.556 with exactly the
prospective 65 probes, giving 910 raw states and 780 fixed comparison rows.
The sum of trajectory runtimes was 941.80 seconds, within the pre-output
45-minute choice rule.

Phase evolves with the full anisotropic rational-plane operator and constant
phase ghosts. Heat evolves on a symmetric truncated graph: every retained
L19 bond transfers one computed number with opposite signs at its endpoints.
These are artificial closed normal ends, not a production native wall,
physical tilted wall, or the BVP outgoing boundary. The primary grid has 1791
cells, approximately [-128.082,512.328] W0; the wide grid doubles both bounds
and retains identical central samples. Storage and arithmetic are Float64.
There is no native GPU or Float32 equivalence claim.

## Conservation, timestep and domain evidence

The latent thermal increment is the actual stored phase increment after any
Euler clamp. No clamps occurred in the completed batch, and no temperature
projection or energy correction was used. At each probe the represented
enthalpy delta*sum(T-psi-background) is accumulated exactly before conversion
to JSON. Its drift is tested against the outward-rounded, code-derived
heat-addition and latent-subtraction bound, rather than an observed drift band.

The maximum absolute exact drift was 1.7898670304782066e-11. The largest ratio
to its corresponding arithmetic envelope was 0.006993703, and the largest
recorded envelope was 2.5593155934593167e-9. All numerical range, clock, source,
input, local-relaxation, metrology and exact-energy checks passed. Separate
manufactured wrong-latent and clamped-latent controls remain live.

Both wide-domain baselines matched the primary-domain core arrays exactly
at all 65 comparison times. Coarse/half-step differences in the frozen common
baseline-mass +/-24 W0 window reached RMS 2.392578369548594e-7 for phase and
1.6420223301226462e-7 for temperature. Registration separately uses phase
+/-12 W0 and temperature +/-24 W0, with one shared phase-derived shift.

| Model | Baseline fitted speed, dt=.004 | Baseline fitted speed, dt=.002 |
| --- | ---: | ---: |
| Principal candidate | 0.03999990987345 | 0.03999995493256 |
| Angular candidate | 0.03999990990548 | 0.03999995494850 |

These are free-intercept slopes over the declared full horizon, with raw
imposed-V differences and the separately declared late slopes also retained.
They are descriptive measurements, not a new acceptance band.

## Signed translations and residual heat

The signed arms retain a real phase displacement as well as a thermal
transient. The following coarse-step offsets are relative to the corresponding
baseline at t=71.556, measured in W0.

| Model/arm | Terminal phase offset | Full-horizon fitted speed | Shared-shift terminal T RMS |
| --- | ---: | ---: | ---: |
| Principal plus | -0.00322016864 | 0.04001264979231 | 2.06648357e-5 |
| Principal minus | +0.00322014923 | 0.03998717026993 | 2.04449706e-5 |
| Angular plus | -0.00322054570 | 0.04001267459883 | 2.06669863e-5 |
| Angular minus | +0.00322052635 | 0.03998714552449 | 2.04471827e-5 |

A fitted trajectory slope is not net displacement divided by time or an
identified final isolated-wave speed. The plus arm can remain behind its
baseline while its fitted slope is larger. Raw imposed-V phase RMS remains
about 3.24e-4; phase-aligned shape RMS is about 1e-7 to 2.5e-7. The retained
raw and registered measurements distinguish actual translation from a small
shape residual. The nonzero temperature residual near 2.05e-5 is reported,
without claiming return to the same wave or separately aligning temperature.

## Verification and limits

The independent audit recomputed all 910 raw hashes, exact energies,
registrations, relaxation/cutoff/range/clamp/clearance records, and all 780
comparison rows. Its separate exact binary accumulator agreed with Fraction
fixtures. A 280-step replay reproduced byte-identical phase/temperature and
the same arithmetic budget. Original and amended audit helpers, the amendment
record and all final audit manifests are retained.

The horizon is only about .04567 of D/V^2. The result concerns this normal,
spacing, identity orientation, input family, selected initial tail spectrum,
two timesteps and finite artificial-end domains. It provides no long-time
recovery predicate or universal boundary/stability result. Zero total heat
does not require return to the identical waveform or phase. Net-heat and
whole-wave translation trajectories were not part of this batch.

The finite sampled box energies, about 62.6524 primary and 62.6700 wide,
remain distinct from the formal infinite continuous-wave identity D/V=62.67.
Using D/E as a speed prediction would additionally require an isolated single
wave carrying all excess energy with no residual radiation. That condition
is not presumed here. Accepted, adopted and q3Accepted remain false.

Original result SHA256:
`2baaf74f0ac992bf982928836987373c024b81e1c9bcb69a1938ff0196268f0a`.
Independent post-run result SHA256:
`2e8a3b403a8abc9fe15cdbbc76205c2138b408e7fb187b076ac5feda61135764`.
Prospective prepare seal SHA256:
`2eeee5df0f4f36765f83c35ed5b6b91fe8645dbd4218cfb441ef73f3f9aa3bcc`.
The audited whitelist archive is
`solidify-q3-oblique-temporal-2026-10-31.zip`; its external SHA sidecar and
machine-readable preservation handoff identify the complete original packet.
