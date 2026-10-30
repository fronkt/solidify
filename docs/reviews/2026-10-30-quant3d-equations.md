# Independent quantitative 3D equation audit

Reviewed revision: `2bd78939bc00f7aa5484cd815e870dcd6ec2d95a`, detached worktree `C:\Users\frank\solidify-review-equations`. Read-only review, 2026-10-30. No GPU or browser experiment, cloud resource, source edit, commit, or push was performed. The only review artifact is this ignored report.

**Verdict: I found no demonstrable error in the pure-material continuum equation, phase/temperature conversion, latent-heat factor, cubic anisotropy derivative, or operator ordering.** The actual implementation consistently approximates the intended Karma–Rappel model. This does not establish a quantitatively calibrated finite-grid sharp-interface model. The remaining capillary/kinetic uncertainty is scientifically material, and the five-arm needle reference remains failed. No coefficient or reference-band change is justified by this audit.

## Severity-ranked findings

### P2 — Finite-grid kinetic cancellation remains unmeasured; continuum cancellation is not a discrete calibration

Locations: `src/shaders3d-quant.ts:28`, `src/shaders3d-quant.ts:39`, `src/shaders3d.ts:322`, `src/quant.ts:185`; evidence and existing qualifications at `docs/QUANT-3D.md:209`, `docs/QUANT-3D.md:231`, and `docs/validation/quant3d-2026-10-30.json:420`.

The implemented relaxation is exactly the appropriate leading continuum choice, `tau(n)=tau0*a(n)^2`, with `Dtilde=a2*lambda`. Its cancellation argument uses continuum interface integrals. Runtime instead combines a 19-point scalar operator, 7-point centered gradient samples, centered divergence of a separately sampled anisotropic correction, explicit Euler, and Float32 state/uniforms. That combination does not inherit an exact zero kinetic coefficient from the continuum formula. This is a missing independent measurement, not a proven wrong relaxation function.

Primary support: [Karma–Rappel 1998](https://doi.org/10.1103/PhysRevE.57.4323), Eq. 63 gives the continuum kinetic coefficient; Sec. VI.B.2, Eqs. 112–115 and Table V separately determine lattice kinetics using planar fronts and check a held-out direction. Their numerical correction belongs to their discretization and must not be copied into this one.

Supplemental evidence: the later `quant3d-kinetic-2026-10-30.json:29` registers one [100] finite-speed profile, V=.04, at dx=.8 with two steps and four cell phases. Its accompanying assessment, `quant3d-kinetic-assessment-2026-10-30.md:16`, reports poor identifiability of the outer liquid extrapolation. Its conclusion at line 20 expressly leaves zero-speed and all-orientation kinetics open. I verified `git diff 2bd7893 9e30318 -- src/shaders3d.ts src/shaders3d-quant.ts src/quant.ts` is empty, so the later evidence concerns these same equations. I did not independently replay its raw checkpoints.

Smallest discriminating experiment: solve the production spatial equations for coupled planar traveling fronts in Float64 on the CPU at the existing dx=.8 and .6. Use several predeclared small speeds, enough cell phases to resolve lattice oscillations, and directly matched outer solid/liquid thermal solutions. Start with [100], then [110], retaining [111] as a prediction. Require extrapolation-window stability and a resolved slope/intercept as V decreases; stop interpreting beta if pinning or fit conditioning destroys identifiability. A negligible outer-temperature/V limit across orientations falsifies appreciable discrete kinetic residual as the explanation. A uniform-temperature phase-only front cannot measure the coupled cancellation. Do not use the needle value to select a correction.

### P2 — The scalar stencil is isotropic through its leading error; the complete anisotropic operator is only a consistent second-order approximation

Locations: `src/shaders3d.ts:214`, `src/shaders3d.ts:280`, `src/shaders3d.ts:320`, `src/shaders3d.ts:322`; claims at `docs/QUANT-3D.md:67` and `docs/QUANT-3D.md:69`. The current document already qualifies the retained correction discretization, so this is a calibration limit, not a newly discovered contradiction in that document.

The 19-point scalar operator and stated stability limits are correct. However, the code evaluates `w*L19(psi) + Dc(w)·Dc(psi) + Dc·A`; discrete centered differences do not obey the continuum product rule. This is not identically a face divergence or the gradient of an established discrete interface-energy functional. The words “full variational cubic operator” correctly describe its continuum target, but should not be used to infer an exact discrete energy law, all-orientation capillarity, or absence of mesh bias. Heat-energy conservation is a different property and does not supply that inference.

Independent calculation in this review supports consistency: for an oblique planar tanh field with normal `(0.2,0.5,sqrt(.71))`, epsilon=.0171, and no boundaries, I evaluated this exact operator structure in double precision and compared it with its analytical continuum value. Errors at h=.4,.2,.1,.05,.025 were `1.2711e-3, 3.3311e-4, 8.4298e-5, 2.1139e-5, 5.2889e-6`; the ratios tend to four. This checks the sign and angular derivative and demonstrates second order, not exact finite-grid equivalence.

Primary support: [Karma–Rappel 1996 PRL](https://arxiv.org/pdf/patt-sol/9607005), p.2 describes independent equilibrium and kinetic lattice calibration. [Karma–Rappel 1998](https://doi.org/10.1103/PhysRevE.57.4323), Sec. VI.B.1, Eq.108 separates physical and effective anisotropy.

Smallest discriminating experiment: complete the already registered fixed-volume equilibrium matrix with at least two radii and two mesh spacings, and compare [100]/[110] support and a held-out [111] support. Also measure local curvature response for the same shapes. If both the inferred surface-energy anisotropy and local capillary response approach the prescribed continuum values while the needle miss persists at matched endpoints, appreciable capillary discretization bias is disfavored. A good fit to one fourth-harmonic support ratio at one finite radius is insufficient to calibrate the entire curvature operator. No lattice coefficient should be inferred from tip P or sigma.

### P2 — Existing point controls narrow the diagnosis but do not identify an asymptotic error or its size

Locations: `docs/validation/quant3d-2026-10-30.json:128`, `docs/validation/quant3d-2026-10-30.json:281`, `docs/validation/quant3d-2026-10-30.json:332`, `docs/validation/quant3d-2026-10-30.json:404`; existing qualification at `docs/QUANT-3D.md:229` and prospective correction at `docs/QUANT-3D.md:241`.

All four pairwise point controls pass their original 10% band; the largest reported difference is 3.1228%. It would be incorrect to call them four failed convergence comparisons. It would also be incorrect to infer that the remaining 16–20% literature miss must therefore be an equation bug: the controls are one-step perturbations, use different first-qualifying terminal windows, and do not provide an asymptotic extrapolation or a joint error bound.

Independent scale reconstruction from the recorded base P, sigma, D and d0 gives `rho/W0=13.12910`, `V*tau0/W0=.1252074`, `W0/rho=.0761667`, and `W0*V/D=.0499471`. The smaller-width arm gives `W0/rho=.0701466` and `W0*V/D=.0456454`. Those are useful small parameters; neither the continuum analysis nor the measurements here provide a theorem making their residual error less than 10%. The later V=.04 planar profile samples about one-third of the base needle's nominal tip speed and no tip curvature. Its precise speed recovery does not establish the curved tip's operating state.

Smallest discriminating experiment: finish the declared fixed-terminal five-arm protocol without changing physical coefficients or bands. If a finite-interface explanation remains plausible, add a separately registered third width at matched physical box, initial condition, endpoint and windows, and refine dx/W0 sufficiently to separate width from mesh error. Only an ordered trend with resolved uncertainty can support extrapolation. Endpoint persistence can be tested on saved later checkpoints if they already exist; no coefficient experiment is required.

### P3 — One cubic-energy source comment has the extrema reversed

Location: `src/shaders3d.ts:152` says the cubic harmonic has minima along <100>. At positive epsilon the code actually gives `a100=1+epsilon`, `a110=1-epsilon`, and `a111=1-5*epsilon/3`; <100> is the maximum of this energy harmonic. The polynomial at lines 154–155 is correct. Preferred dendrite growth along <100> must not be explained by calling it the energy minimum; surface stiffness matters.

Primary support: [Karma–Rappel 1996 PRL](https://arxiv.org/pdf/patt-sol/9607005), Eq.4 and Fig.1. Minimal falsification is direct substitution of these three unit normals. Proposed change: correct that comment only. This cannot explain the numerical sigma miss.

## Equation and unit chain checked

Let `s` denote stored phase (`phi` in the WGSL, `psi` in the design document), `q=2s-1` the paper's phase, and `u=Ttilde-1` in the pure model. Liquid is `s=0,q=-1`; solid is `s=1,q=+1`. The shift makes pure melting temperature Ttilde=1 and undercooling Delta=1−Ttilde. See `src/shaders3d.ts:250`, `src/shaders3d-quant.ts:16`, and `src/shaders3d-quant.ts:18`.

The code implies, before clipping and external sources,

```
tau(n) ds/dt = div[W0² a² grad(s) + W0² a |grad(s)| (I−nnᵀ) grad_n(a)]
              + 1/2 {q−q³−lambda(1−q²)² u}
dTtilde/dt = Dtilde Laplacian(Ttilde) + latent ds/dt.
```

Multiplying the phase equation by two recovers the standard q equation because the anisotropic operator is homogeneous of degree one in the phase gradient. Thus the reaction's one-half and the unhalved stored-phase spatial operator are jointly correct. For a pure calibration latent=1, so `ds/dt=(1/2)dq/dt` gives precisely the paper's heat source. Its sign heats a growing solid. The tanh scale is `s=[1−tanh(r/(sqrt(2)W(n)))]/2`, rather than a factor-of-two variant.

For a grain rotation R, `n'=Rᵀn`, `a=1+epsilon[4 sum(n_i'^4)−3]`, and `grad_n'(a)=16 epsilon (n')³`. `src/shaders3d.ts:231` rotates the derivative back and line 233 applies the tangential projection. These are exactly the chain-rule terms required by direction-dependent W; no missing factor of two or reversed sign was found. Reversing n leaves a unchanged. `fC.w=W0² a²` and division by `epsBar²` in `src/shaders3d-quant.ts:28` consequently supply `tau0*a²`.

For the physical bridge, `src/quant.ts:157`, `src/quant.ts:181`, and `src/quant.ts:185` yield

```
DeltaT0 = L/cp                         [K]
d0 = Gamma/DeltaT0                     [m], with Gamma in [K m]
W0 = lambda*d0/a1                      [m]
tau0 = a2*lambda*W0²/D                 [s]
Dtilde = D*tau0/W0² = a2*lambda        [dimensionless]
a1=.8839, a2=.6267; latent=(L/cp)/DeltaT0=1.
```

The a2 constant is for linear latent interpolation h(q)=q, which is what this heat source uses. The main application sets epsBar=tau=1 in those units (`src/main.ts:541`) and passes Dtilde to dTherm. The continuum beta expression reduces algebraically to zero for every orientation when tau=tau0*a². This is the continuum result audited above, not a measured statement about beta on the runtime lattice.

Primary equation cross-reference: [1996 PRL](https://arxiv.org/pdf/patt-sol/9607005), Eqs.4–7; [1998 PRE](https://doi.org/10.1103/PhysRevE.57.4323), Eqs.22–25, Table I, Eqs.60–63 and 98–100. The complete 1998 paper was read through a [text mirror of the primary article](https://studylib.net/doc/10908329/quantitative-phase-field-modeling-of-dendritic-growth-in-...); the author-hosted `quan23.pdf` currently returns 404. No secondary model exposition supplied the equation comparisons.

## Stencil, boundaries, heat ledger and ordering

For h=dx, the implemented scalar stencil has six weights 1/3, twelve edge weights 1/6 and central weight −4, all divided by h². Direct moment sums give `M200=2`, `M400=2`, `M220=2/3`; hence

```
L19 f = Laplacian(f) + h²/12 Laplacian²(f) + O(h⁴).
```

The sixth moments `M600=2`, `M420=2/3`, `M222=0` do not have full isotropy. This establishes exactly the documented order, not a fourth-order or all-orders isotropic method. With `c_i=cos(k_i h)`, its dimensionless symbol is `(2/3)[cx+cy+cz+cx cy+cx cz+cy cz−6]`. Its minimum is −16/3, e.g. at `(cx,cy,cz)=(-1,-1,1)`. Euler diffusion therefore has spectral bound `dt <= 3h²/(8D)` and nonnegative central weight bound `dt <= h²/(4D)`. `DT_SAFETY_3D=1/12` is conservative relative to both. These bounds establish scalar diffusion stability only; the source correctly treats reaction/anisotropy and local relaxation separately.

At a cell-centered symmetry face, scalar ghosts and w are even and the normal correction A is odd. `src/shaders3d.ts:333` through line 339 implements that normal correction. An independent linear probe `A_x=x` at the lower face gives derivative 1 with the odd ghost and 1/2 with clamping; this agrees with the purpose of the recorded boundary test. The corrected code covers all six faces and takes its extent from the flux texture, including rectangular specializations.

Qualification: the full/octant fixture uses identity quaternions (`scripts/fixtures/quant3d-boundary.mjs:16`, line 97). Even-w/odd-A reflection follows for a crystal with that coordinate mirror symmetry. It must not be advertised as a general proof of oblique-crystal natural boundary conditions: at arbitrary rotated cubic orientation, the crystal need not have the lab plane as a symmetry, and scalar mirror extension alone does not make its constitutive w even. The arbitrary-orientation test currently verifies a different live field, not covariance under spatial rotation (`scripts/verify-quant3d.mjs:120`). This does not implicate the aligned single-crystal needle benchmark. If general boundary accuracy is needed, the minimal test is an oblique fixed-orientation manufactured boundary field with the natural total phase flux imposed and h refinement; comparing an oblique full crystal to an untransformed octant is not a valid symmetry reference.

`src/sim3d.ts:2154` dispatches FLUX from the old state/grain, then PHI from that old state and flux, then TRANSPORT from the old state and the new phase increment; only then does line 2171 flip. `src/shaders3d.ts:581` uses old T for conduction and the same step's dPhi for heat release. This is the intended coupled forward-Euler step; it is not a phase/heat time-level mismatch. The pore and wall replacements at lines 567 and 571 apply dTherm under coupled heat, and imposed temperature omits conduction/latent feedback as declared.

With sources, walls, pores and clipping inactive, summing the heat equation conserves `sum(Ttilde−latent*s)` in exact arithmetic because the reflected scalar stencil has zero global sum. The state is Float32, so this is not exact arithmetic conservation. Temperature clipping or active external programs also changes that ledger by construction. The documented energy fixture avoids those branches; its finite drift cannot independently determine interface kinetics.

## Scope and final disposition

The pure phase and heat chain, cubic derivative, W/tau mapping, scalar stencil, symmetry-face parity, explicit update order, and reference P/sigma definitions were traced. Sphere critical radius has two principal curvatures, `R*=2d0/Delta`; the cylinder control has one, as the fixture records. `criticalRadiusCells` in `src/quant.ts:307` is a one-curvature formula with no current callers; I did not infer a live 3D seeding defect from that unused helper.

The EFKP alloy model and its numerical partition calibration are a separate scope and are not scientifically validated by this pure-material audit. Multigrain-boundary physics, stochastic twins, walls and pores do not occur in the accepted pure needle setup and were not proposed as explanations for its miss.

There are no P0/P1 demonstrated solver defects in this review. The definite source error is the low-severity energy-extremum comment. The P2 findings are distinct, acknowledged scientific evidence gaps that prevent promoting continuum calibration into a proven finite-grid prediction. Retain the failed literature verdict and the passing point-control verdicts, complete independent capillary/kinetic and fixed-endpoint checks, and change a solver coefficient only after a separately identifiable physical or discretization error is established.
