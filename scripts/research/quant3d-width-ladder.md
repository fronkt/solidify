# Q3c interface-width ladder: hypotheses, CPU evidence and frozen protocol

Status: protocol frozen 2026-11-07 before any GPU execution. This is a research
diagnostic. Its verdict can support or refute a hypothesis about the 3D
selection-constant miss; it can never accept Q3. The five-arm literature gate,
its 10% bands, the metrology, the fixed terminal endpoint and every physical
coefficient stay unchanged. No band, estimator, endpoint or coefficient below
was chosen to move a result toward the reference.

## 1. Where Q3c stands

The full five-arm literature reference still misses sigma*: 0.0502-0.0529
(default, protocol v3, 12ce78b) and 0.0511-0.0545 (lattice-kinetics candidate,
protocol v4 fixed terminal, a11a814) against 0.063. P passes. The two
"recorded next targets" in the 10-30 notes were completed on this branch on
10-31: paired-lattice-phase capillary refinement at dx/W0 0.8/0.6/0.4 (finest
octic C100 errors 0.33-0.65%, no coefficient inferred), and the off-principal
kinetic reduction with the sealed angular candidate
`c = 1321/9870 + (1084/1645) gamma` (CPU 87 profiles, GPU operator capture,
14-trajectory temporal pilot). Neither has been run in a needle campaign; the
temporal pilot is short-time Float64 evidence and establishes no long-time
stability. This document steps back from those two threads.

## 2. Literature facts used here (verified 2026-11-07, legal sources only)

1. Karma and Rappel, PRL 77, 4050 (1996), arXiv:patt-sol/9607005v1 (SHA256
   `0ad81481...d64453`, identical to `verify-out/q3-kr96.pdf`).
   - Table I, PDF p.3, Delta = 0.45, eps4 = 0.0171: phase field P = 0.312,
     sigma* = 0.063, alpha = 1.68, 1/A = 10.1; numerical solvability P = 0.324,
     sigma* = 0.0578; linear solvability P_Iv = 0.471, sigma* = 0.0367. The
     same table: eps4 = 0.0123 gives 0.360/0.036/1.73/11.3, eps4 = 0.0265 gives
     0.236/0.16/1.62/7.8. Lattice: 200x200x400.
   - p.2: "simulated explicitly with a grid spacing ranging between 0.6 and 0.8
     with W0 = 1, D ranging between 0.5 and 4, a time step ranging between 0.01
     and 0.08, and a constant undercooling Delta = 0.45."
   - p.2: "Several runs were performed to check that the values in Table 1 are
     independent of d0/W0 within an accuracy of 10%." The paper does not say
     which D (lambda = D/0.6267, so 0.8-6.4) produced the eps4 = 0.0171 row.
   - p.2: "The grid-corrected anisotropy is then defined as that value of eps4
     in gamma(n) which produces a 3D equilibrium shape that matches exactly that
     of the phase-field model. A procedure that will be described elsewhere was
     also developed to obtain a grid-corrected tau(n)." The tabulated eps4 is an
     effective (equilibrium-calibrated) anisotropy and KR96 also corrected the
     lattice kinetics.
   - Eq. 8, p.3: r^2(phi, z) = sum A_n(z) cos 4n phi with r, z in units of rho,
     A1(z) = A |z|^alpha "up to a distance of a few rho behind the tip".
   - The PRL never states how rho is measured.
2. Karma, Lee and Plapp, PRE 61, 3996 (2000), arXiv:cond-mat/9909021 (Sec.
   III.C): "For the phase-field shape, rho is computed from the phi = 0 section
   using the interpolation scheme that is described in Appendix B of Ref. [13]"
   (Ref. [13] = KR96 and KR98). The same paper describes "a localized shape
   distortion near the tip that only affects the value of the tip radius", gives
   rho/rho_Iv ~ 1 - 15 eps4 (Eq. 13), and recommends the velocity-based
   sigma_p = 2 D d0 / (rho_p^2 V) with rho_p = rho_Iv because the true tip
   radius is hard to measure. Its Table I covers Delta = 0.1 and 0.2 only.
3. Lu, Beckermann and Ramirez, J. Cryst. Growth 280, 320 (2005), author copy
   at beckermann.lab.uiowa.edu: the actual tip radius "represents the local
   radius of curvature of the solid-liquid interface at the very dendrite tip.
   It is calculated from the phase-field contours in the x-y (phi = 0) plane
   using the method detailed in Appendix B in Karma and Rappel" (secondary
   corroboration of item 2).
4. Karma and Rappel, PRE 57, 4323 (1998): closed access (Unpaywall/OpenAlex:
   `is_oa=false`), not on arXiv. Its APS abstract confirms 3D "grid corrections
   due to the surface tension and kinetic anisotropies". UNCONFIRMED in this
   session: Appendix B (the radius interpolation), Sec. VI.B, Eq. 108, Table V
   and the fixture's `eps_eff = eps_raw - (dx/W0)^2/240` example. An earlier
   review read a third-party text mirror; that is not re-verified here.

No later open 3D benchmark at Delta = 0.45, eps4 ~ 0.017 was found.

## 3. CPU replay of existing raw checkpoints (no GPU)

`quant3d-q3c-tip-replay.py` re-reads all 179 default (12ce78b, archive SHA
`72b3860f...7dce`, local copy `solidify/verify-out/q3-metrology-v4-raw`) and
305 candidate (a11a814, `solidify-q3-candidate-2026-10-30.tar.gz`, SHA
`ceea1d7c...cbb23f`) tip checkpoints. A NumPy port of the unchanged estimator
reproduces every published terminal P and sigma* (base 0.327880/0.051333 and
0.330293/0.052696). Summary:
`docs/validation/quant3d-q3c-replay-2026-11-07.json`. With
P_Iv(0.45) = 0.470980 (Float64), sigma* = (V d0/D) / (2 P_Iv^2 (rho/rho_Iv)^2):

| Run | V d0/D | vs KR96 PF | rho/rho_Iv | vs KR96 PF | sigma* | A1(-1) | A1(-2) |
|---|---:|---:|---:|---:|---:|---:|---:|
| KR96 PF (eps 0.0171) | 0.012264 | - | 0.6624 | - | 0.063 | 0.0990 | 0.3173 |
| KR96 solvability | 0.012135 | -1.1% | 0.6879 | +3.8% | 0.0578 | - | - |
| Default base, first window | 0.011037 | -10.0% | 0.6962 | +5.1% | 0.051333 | 0.0989 | 0.3172 |
| Candidate base, fixed terminal | 0.011498 | -6.2% | 0.7013 | +5.9% | 0.052696 | 0.0951 | 0.3055 |

- The selected velocity (definition-free) is 6-10% slow and the local apex is
  5-6% too blunt relative to its own Ivantsov radius. The four-fold tip
  morphology in local-radius units matches KR96 at eps4 = 0.0171 (default
  A1(-1) 0.0989 vs 0.0990; fitted 1/A 10.11, alpha 1.686). Morphology is only
  weakly sensitive to eps4 (about 8% per 0.005), so it does not pin a 3% eps4
  mismatch.
- Stationarity: the candidate terminal trend of sigma* is +0.08% +- 0.15% per
  D/V^2; default first-window versus fixed-terminal BASE differ by 0.16%.
  Domain and half-dt arms move sigma* by at most 0.49% (default) and 0.08%
  (candidate). Time, domain and dt are excluded as causes.
- Width arm (lambda 4 -> 3.6, W0/d0 -10%): V d0/D +1.54%/+1.17%, rho/rho_Iv
  -0.77%/-1.12%, sigma* +3.12%/+3.47% (default/candidate). Window velocity
  scatter is 0.07-0.5%, so the velocity trend is resolved in both campaigns.
- dx arm (0.8 -> 0.6): sigma* -2.2%/-3.0%, rho/rho_Iv +1.7%/+1.25%. Mesh
  refinement moves sigma* away from the reference, opposite to the equilibrium
  eps_eff trend (0.01660 -> 0.01681).
- Post-hoc, two-point extrapolations to W0 -> 0 (diagnostic only, not a
  measurement): quadratic-in-W gives candidate V d0/D 0.012224, rho/rho_Iv
  0.6611, sigma* 0.06304; linear-in-W gives 0.012917, 0.6269, 0.0741. The
  default quadratic gives sigma* 0.0604. This suggested the hypothesis below;
  it is not evidence for it.
- Apex profile: the axisymmetric secant radius A0(s)/(2s) rises from 1.032 at
  depth 0.05 rho to 1.229 at 1 rho (candidate base); it is self-similar in rho
  units across lambda 4/3.6 and slightly weaker at dx 0.6.

## 4. Ranked hypotheses for "sigma* low while P passes"

1. **Finite interface width (thin-interface higher-order error) in selection.**
   Predicts V d0/D rising and rho/rho_Iv falling monotonically as W0/d0
   decreases, with a functional form that extrapolates near the reference.
   Existing data: the only resolved, replicated control sensitivity; a 10%
   width change moves sigma* 3.1-3.5%, which the original 10% pointwise
   control band could not flag as unconverged. The equilibrium matrix shows
   continuum capillary width effects below 0.2% at R20, so the effect, if real,
   is dynamic. Two points cannot fix the form. Cheapest test: this ladder.
2. **Anisotropy definition.** KR96's 0.0171 is equilibrium-calibrated; the
   fixture sets raw 0.0171, whose measured equilibrium eps_eff is 0.01660 at
   dx 0.8 (R20). Using KR96's own Table I slopes, -2.9% eps predicts about
   -4.9% sigma* and -2.4% V. Explains at most a third of the miss. Test: an
   arm whose raw eps4 is set by the existing equilibrium calibration (about
   0.01761 at dx 0.8). That is a coefficient change matching the reference's
   definition, so it needs the root's explicit decision; not registered here.
3. **Lattice kinetic residual.** Measured: the principal-plane correction moved
   V +4.7% and sigma* +2.5% (fixed-terminal default 0.051416 to candidate
   0.052696). KR96 also grid-corrected tau(n). The angular term vanishes at
   [100] and has not been run in a needle; its sign is unknown. The candidate
   dx arm moves V -0.6%, so the remaining lattice kinetic error at dx 0.8 looks
   small. Finite-speed stability remains unestablished (temporal pilot only).
4. **Tip-radius definition/metrology.** KR measure the local apex curvature in
   the phi = 0 plane (KLP 2000), which is what our estimator targets. New
   known-truth controls built from the measured apex profile (Section 6) give
   estimator rho bias at most +0.38% (sigma* -0.8%). Not the cause at the
   percent level, and the velocity deficit is independent of radius metrology.
5. **Reference precision.** KR96 state 10% d0/W0 independence and differ from
   their own solvability value by 9% in sigma*. Even a perfect solver could
   miss a 10% band around 0.063. Not testable by a GPU run; it limits what any
   single comparison can conclude.
6. Excluded by existing data: measurement time/stationarity, domain size, dt,
   lattice capillary refinement (moves the wrong way), local-radius estimator
   variants (< 1%).

## 5. Frozen GPU experiment: Q3c-W1 interface-width ladder

Model: production quantitative 3D shaders with the existing opt-in
`latticeKinetics` research option (a11a814 candidate; default-off WGSL identity
was proven there and no shader source changed on this branch). Every other
input equals the five-arm base: eps4 0.0171 raw, Delta 0.45, dx/W0 0.8,
physical extents and seed radius matched in d0 (cell counts rounded up), dt by
the unchanged `baseDt` rule, fixed terminal physical time 1949.1356 base tau0,
protocol v4 schedule, ten retained checkpoints, unchanged local-tip metrology.

| Arm | lambda | W0/d0 | dims | dt | terminal steps | est. Arc 140V |
|---|---:|---:|---|---:|---:|---:|
| w50 | 5.0 | 5.657 | 216x216x490 | 0.0170204 | 58,634 | 20 min |
| w44 | 4.4 | 4.978 | 246x246x557 | 0.0180006 | 81,354 | 42 min |
| w40-anchor | 4.0 | 4.525 | 270x270x612 | 0.0180006 | 108,282 | 73 min |

Run order w50, w44, w40-anchor. Estimates use the measured local rate
1.099e9 voxel-substeps/s (2026-10-30); total about 2.3 h compute, plus
checkpoint readback, roughly 2.5-3 h. Textures 1.3/1.9/2.5 GiB. Local GPU only;
no cloud rental is needed for W1.

Primary endpoint: V d0/D from the ten retained terminal checkpoints. Secondary:
sigma*, rho/rho_Iv (P_Iv = 0.470980). Archived inputs (a11a814, NVIDIA):
lambda 4 V d0/D 0.011497657, sigma* 0.052696234, rho/rho_Iv 0.701289; lambda
3.6 0.011632267, 0.054522300, 0.693470.

Frozen predictions from the archived pair (re-based on the Intel anchor at run
time; the values below use the archived lambda 4 point):

| lambda | V d0/D quadratic | V d0/D linear | sigma* quadratic | sigma* linear |
|---:|---:|---:|---:|---:|
| 5.0 | 0.0111082 | 0.0111679 | 0.0476409 | 0.0483942 |
| 4.4 | 0.0113507 | 0.0113646 | 0.0507490 | 0.0509313 |

Decision rule (implemented in `quant3d-width-ladder-model.mjs`, evaluated in
this order):

1. `refused-execution`: exception, any device/page error, unreadable ledger,
   source change, or missing exact-source capture before browser admission.
2. `refused-validity`: any arm not complete at its terminal step, not
   stationary/resolved by the unchanged protocol, not boundary-clear by 8
   conservative D/V at every retained sample, or with under 6 conservative D/V
   of travel.
3. `refused-platform-anchor`: Intel lambda 4 differs from the archived NVIDIA
   lambda 4 by more than 0.25% in V d0/D or 1% in sigma*.
4. `width-trend-refuted`: V d0/D is not strictly decreasing over lambda
   3.6 -> 4.0 -> 4.4 -> 5.0 with every step larger than twice the larger
   window-velocity spread of the two arms.
5. Form: RMS log residual of V d0/D at lambda 4.4 and 5.0 against each
   prediction. `width-trend-quadratic-supported` if RMS_Q <= 0.2% and
   RMS_Q <= 0.5 RMS_L; `width-trend-linear-supported` symmetrically; otherwise
   `width-trend-form-unresolved`. Sigma* residuals are reported only.
6. If a form is supported, a reference-blind follow-up width is reported: the
   widest lambda in {3.2, 2.8, 2.4, 2.0} whose predicted remaining width error
   in V d0/D is within 2.5%, or none. Diagnostic W0 -> 0 values are reported
   and never compared to a band.

Known-truth and negative controls (CPU, must pass before and at every run):
quadratic, linear, W^1.5 (unresolved), flat (refuted), +-0.1% worst-sign noise,
swapped ladder (refuted), anchor +0.5% (refused), invalid arm and failed
execution (refused). The real CLI also runs end to end under a synthetic
browser (`quant3d-width-ladder-cli-controls.mjs`): quadratic truth, flat truth,
a drifting-radius tip (refused-validity) and a manufactured GPU error
(refused-execution, exit 1).

What each verdict means for Q3c, fixed now: quadratic or linear support
justifies a separately pre-registered narrow-width five-arm reference campaign
at the reported follow-up lambda (cloud-class hardware, see Section 7);
`form-unresolved` justifies a direct narrow ladder instead of extrapolation;
`refuted` drops the width hypothesis and moves to items 2-3 of Section 4. No
branch changes a band or reclassifies an earlier failure.

## 6. CPU known-truth metrology at the ladder resolutions

`quant3d-width-ladder-metrology.mjs` samples Float32 tanh brackets of four
surfaces at rho/dx 12.7, 14.4, 15.9 and 17.6 (predicted lambda 5, 4.4, 4, 3.6)
with ten sub-cell offsets plus a twelve-checkpoint moving sequence. Declared
bounds: rho within 1%, moving V within 0.25%, sigma* within 2.5%. All three
bounded models pass; largest static rho errors: paraboloid 7.6e-7, KR
eps 0.0171 morphology -0.13%, measured apex profile (fit to the replay,
A0/(2s) = 1 + (0.695 s + 0.0574 s^2)/(1 + 2.299 s)) +0.38% at rho/dx 12.7 and
+0.10% at 15.9. Moving sigma* errors are at most -0.76%. The doubled-distortion
stress model (report only) reaches +0.51% in rho and -1.0% in sigma*. These
controls assume the apex profile is analytic below the 5-cell depth the data
resolve.

## 7. Wall time, hardware and what local hardware cannot do

W1 fits the Intel Arc 140V. Closing Q3 needs the unchanged five-arm gate at a
converged width. If the quadratic form holds, the reference-blind rule selects
lambda 2.4: the base arm alone is about 21x the lambda 4 cost (about 26 h on the
Arc, 70 min on an RTX 5090), and its dx = 0.6 arm needs about 489 M voxels
(about 30 GB of textures), beyond the Arc and at the edge of a 32 GB card. A
full five-arm campaign there is about 220 base-arm units (about 12 h on one
5090, longer on the Arc than is practical). An 80 GB-class cloud GPU or a
separately justified reduced-domain protocol (the candidate domain arm moved
sigma* by 2e-6) would be needed. The root decides on any rental.

## 8. Commands

```text
# CPU only (default): verdict controls, ladder metrology, plan
node scripts/research/quant3d-width-ladder.mjs verify-out/q3c-width-ladder-selftest
node scripts/research/quant3d-width-ladder-metrology.mjs verify-out/q3c-width-ladder-metrology
node scripts/research/quant3d-width-ladder-cli-controls.mjs verify-out/q3c-width-ladder-cli-controls
python -I scripts/research/quant3d-q3c-tip-replay.py --self-test

# GPU (root only; one GPU owner, frozen pushed source, Vite on the port)
node scripts/research/quant3d-width-ladder.mjs verify-out/q3c-width-ladder 5199 --run

# Afterwards, replay the new raw checkpoints with the same CPU tools
python -I scripts/research/quant3d-q3c-tip-replay.py --campaign ladder=verify-out/q3c-width-ladder/samples --out verify-out/q3c-width-ladder/replay.json
```

The replay script discovers any `<arm>-<step>.json` names, so it also reads the
ladder samples (w50, w44, w40-anchor) for the trend and morphology diagnostics.
The verdict is the CLI's alone.

## 9. Limitations

- Two archived points define the predictions; higher-order terms grow on the
  wide side, so a supported form is evidence about lambda 3.6-5, not proof of
  the W0 -> 0 limit.
- The candidate kinetic option is a research model, not the application
  default. Default-model width response is not re-measured here (existing data:
  +1.54% V per 10% width, versus +1.17% for the candidate).
- Lattice errors at fixed dx/W0 do not vanish along the ladder; any W0 -> 0
  value still carries the dx/W0 = 0.8 lattice error (dx arm: sigma* -3%).
- The anisotropy-definition (Section 4 item 2) and angular-kinetic hypotheses
  are not tested by W1.
