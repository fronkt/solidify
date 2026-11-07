# Known-truth tip-radius controls

Run from the repository root:

```text
node scripts/research/quant3d-metrology-controls.mjs [output-directory]
```

This small CPU diagnostic imports the unchanged tip estimator. It needs no Vite,
browser, GPU, database, or archived simulation. Exit zero means the measurements
completed, **not** that their accuracy passed. `UNDERCOVERED` rows remain visible
in stdout and the JSON report; the script does not change any estimator or
acceptance threshold.

The controls have independently known local principal radii rho=13. They use
dx=.8,.6,.4 and ten vertical subcell offsets, Float32 tanh phase brackets, and
the real quintic/cubic interpolation. Representative raw brackets and their
SHA256, model parameters, estimator/script hashes, and the Git revision are
saved with every report. A separate constant-speed sequence uses V=.11 and the
existing ten-percent operating-state target.

## Models and provenance

[Karma and Rappel, PRL 77, 4050 (1996), Eq.8 and Table I](https://arxiv.org/pdf/patt-sol/9607005)
motivate three fourfold controls:

```
r² = 2s + A s^alpha cos(4theta),  s=(tip-z)/rho
(A,alpha) = (1/13,1.78), (1/10.1,1.68), (1/4,1.54)
```

Here x,y,r,z are normalized by rho. Since alpha>1, the exact quadratic tip
curvature is 1/rho. The paper's finite-depth morphology fit does not certify
this law arbitrarily close to the tip. A paraboloid provides a simpler control.

The independent stress surface is defined directly in Cartesian coordinates.
For normalized X=x/rho, Y=y/rho, r²=X²+Y², H4=X⁴−6X²Y²+Y⁴:

```
(z-tip)/rho = -r²/2
 + A/2^(alpha+1) H4 (r²+2c4)^(alpha-2)
 + B/2^(beta+1) r⁴ (r²+2c0)^(beta-2)
A=1/10.1, alpha=1.68, B=.5, beta=1.25, c4=.01, c0=.001
```

Both correction terms are smooth and begin at fourth order. Thus the Hessian
at the axis is exactly -I/rho. B, beta, and the crossovers are synthetic stress
inputs, not published dendrite coefficients or values fitted to a desired P or
sigma. The axisymmetric crossover radius is about .58 W0, below the diffuse
width. This mathematical counterexample does not establish that an evolved
phase field contains such a crossover.

## Reproduced result

With the current estimator, all 30 phase-sampled cases for each published-style
fourfold model cover their known radius. The epsilon=.0171 model's sigma bias
is between -.056% and +.033% at fixed speed.

The smooth stress model covers **0/30** known radii: radius bias is +8.52% to
+8.66%, while its largest advertised relative radius error is 3.75%. Sigma bias
is -15.31% to -15.09%. Its moving sequence is stationary and marked resolved,
with advertised sigma uncertainty 7.90% against actual error 15.31%.

The Float32 paraboloid also reports 8/30 tiny interval misses (maximum radius
error about 8.5e-7 relative); these are reported rather than relabeled as
coverage successes. This distinguishes absolute achieved accuracy from whether
the estimator's particular error interval contains the truth.

`metrology-controls.json` retains every achieved error, advertised `rhoError`,
window fit and operating-state result. `raw-controls.json` retains 15 selected
synthetic phase snapshots for independent replay. This diagnostic establishes
uncertainty undercoverage; it does not correct the archived needle values or
accept quantitative 3D.
