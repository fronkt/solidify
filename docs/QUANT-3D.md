# Quantitative 3D solidification: implementation and acceptance contract

Status: 2026-10-30. The core and active-mode integration are implemented. Legacy preservation, allocation transactions, analytical geometry/heat checks, alloy partition/width checks and app integration pass GPU acceptance. The complete five-arm 3D needle campaign missed the published reference and Q3 remains unfinished. The acceptance targets below remain distinct from the recorded results.

## Scope and order

Freeze accepted phase data first. Then record untouched 3D Kobayashi fixtures, split the volume update without changing its behavior, implement the calibrated pure model, implement conservative dilute-alloy transport, and integrate active-mode controls and provenance. Convection and additional solid phases remain separate.

The supported physical calibration initially covers isotropic and smooth cubic interface energy. Hexagonal, icosahedral and cusped/faceted growth keep their existing Kobayashi behavior with a visible explanation when quantitative calibration is requested. Their mathematical anisotropy functions are not sufficient evidence of a measured physical calibration. The current `MaterialSI.eps4` is not a hexagonal anisotropy measurement.

The pure model includes heat diffusion and latent heat. The alloy model uses one-sided solute diffusion, conservative anti-trapping transport, and the Echebarria–Folch–Karma–Plapp temperature-dependent relaxation factor. Alloy calibration defaults to an imposed temperature field; its independent partition/width checks use fixed temperature. This supports prescribed thermal programs/gradients without pretending to solve the physical thermal/solute Lewis-number separation on one mesh. A complete coupled heat/solute model remains outside this port's claim.

## Implementation seams

- `src/shaders3d.ts`: the original fused update and diagnostic split share unchanged Kobayashi expression fragments. `phi3dWgsl` and `transport3dWgsl` compose calibrated equations from `src/shaders3d-quant.ts`; the original grain-frame `aniso3` remains shared by both models.
- `src/sim3d.ts`: `enableQuant()` transactionally prepares resources without activating the solver. `splitPasses=true` selects split Kobayashi for comparison; `params.solver=1` always selects the quantitative split. Existing `readStateVolume`, `readGrainVolume`, `readMaskVolume` and `readSoluteVolume` support independent CPU recounts.
- `src/shaders.ts`: shared 2D phase/transport source composition, the stored phase convention, `uSup`, `cFromU`, and face anti-trapping supply useful algebra. Their discretizations are not automatically a correct 3D implementation.
- `src/main.ts`: dimension-specific calibration, snapshots, cell pitch, active chemistry, shares and exports must agree with the active solver. These integration changes are verified separately from the direct-class numerical fixtures.

## Split with zero Kobayashi change

Extract the fused shader into one source for loads, phase evolution, and transport/bookkeeping. Generate the existing fused variant and new `PHI3D`/`TRANSPORT3D` variants from those same fragments. Leave the existing fused path as the default for Kobayashi.

Add a lazily allocated, single-buffered `rg32float` 3D texture carrying `(psi_new, delta_psi)`. A substep becomes:

```
FLUX(old state, old grain, quaternions)
PHI(old state, old solute, flux) -> phase auxiliary
TRANSPORT(old state, old grain, old solute, auxiliary) -> next state/grain/solute
flip state/grain/solute once
```

Only transport may change age, grain IDs, growth twins, pore identity or solute. The phase pass must write auxiliary values for every wall and pore early-return case as well as ordinary cells. Keep stamp ordering, solute copying across a stamp flip, feed iteration count/generation, per-submit noise frame, and scenario time exactly as before. Do not move `P.frame` increments into substeps during this refactor.

Kobayashi comparison uses full field bytes, rather than solid fraction alone: state, grain IDs, age/Niyama, solute, mask and feed state at fixed substep checkpoints. Disable stochastic growth twins for the strict byte comparison because GPU atomic allocation can permute newborn grain IDs across schedules. Separately exercise twin creation, parent/child misorientation and surviving grain statistics.

First require exact equality on the same device. If shader contraction prevents it, investigate operation ordering; do not silently replace the contract with a loose morphology tolerance. Preserve an untouched fused fixture and its source/adapter/build identity.

## Fields, uniforms and bindings

Keep state as `rg32float = (psi,T)`, concentration as the existing separate `r32float` pair, grains as the existing `r32uint` pair, and age as the existing `rg32float` field. Do not introduce a stored supersaturation texture.

Append fields to the 192-byte `P3` structure without moving existing offsets:

| Slot | Type | Meaning |
|---|---|---|
| 48 | u32 | solver: Kobayashi or quantitative |
| 49 | f32 | coupling lambda |
| 50 | f32 | thermal diffusivity in solver units |
| 51 | f32 | anti-trapping coefficient |
| 52 | u32 | imposed-temperature flag |
| 53–55 | padding | reserved; total uniform size 224 bytes |

Every `P3.BYTES` consumer must grow, including stereology's independent parameter buffer. Check WGSL compilation messages and minimum binding sizes, not only TypeScript types.

The pure phase pass needs uniform, state, grain/mask for early-return identity, anisotropic flux, and one storage auxiliary. The alloy variant additionally samples concentration. Transport can replace the old flux sampler with the auxiliary sampler; retain the old output layouts and quorum of quaternions/twin allocator/mask/feed inputs. Pure transport still writes three storage textures; alloy transport writes four. Check **device** limits for the requested pipelines. Never dummy-bind a statically unused storage texture.

## Pure calibrated equations and stability

The public stored phase remains `psi` in [0,1]; define `phi = 2 psi - 1` inside the model. Halve the standard phase reaction while retaining the existing linear anisotropic operator on psi. For cubic energy use the existing grain-frame quaternion rotation and

```
a(n) = 1 + epsilon4 [4(nx^4 + ny^4 + nz^4) - 3]
tau(n) = tau0 a(n)^2
```

The existing flux stores `epsBar^2 a^2` in `.w`, so the local relaxation factor is available without another texture. This is the full variational cubic operator, not a directional multiplier on the Laplacian. Material calibration uses the measured `si.eps4` rather than the qualitative `to3D` tuning.

Use W0 and tau0 as solver units. Reuse the physical calibration for d0, W0, tau0 and the temperature reference, with dimension-aware timestep selection. Quantitative phase and heat now use the 19-point scalar Laplacian `(2 faceSum + edgeSum - 24 center)/(6 dx^2)`, with six face and twelve edge neighbors. Its leading truncation error is `dx^2 Laplacian^2/12`: it remains second order, while removing the leading lab-frame cubic error of the 7-point scalar stencil. The anisotropic variational correction and conservative solute face currents retain their existing discretizations. The original fused and diagnostic split Kobayashi paths retain the 7-point expressions.

The 19-point scalar diffusion Fourier stability edge is `dt <= 3 dx^2/(8 Dtilde)`; the stricter nonnegative-weight bound is `dx^2/(4 Dtilde)`. Retain the existing conservative 3D coefficient `1/12`, below both bounds, without changing 2D defaults. The independent fixed-volume Wulff comparison below measures the resulting improvement and residual bias, without changing material anisotropy or fitting to a needle. Reaction and anisotropy stability still require verification; these scalar bounds do not establish full-scheme stability.

Under imposed temperature, omit conduction and latent feedback but retain the explicitly selected external program. Under coupled pure heat, multiply conduction by `dTherm` in all ordinary, pore and wall branches. Niyama's non-latent cooling rate must use that same factor; otherwise the defect map becomes inconsistent with the temperature evolution.

For an alloy, multiply the local relaxation by `1-(1-k)Ttilde`, using the same solidus-referenced Ttilde as the driving term `U+Ttilde`. This is the temperature factor from EFKP equation 11 after changing reference units. Non-positive local relaxation at an interface is outside this model's valid domain: report a diagnostic refusal rather than flooring the factor into a different kinetic model. A fully liquid hot voxel can remain liquid while the imposed field cools; it must not be forcibly seeded into invalid interface kinetics. The phase timestep must also account for the smallest admitted relaxation factor, not just the diffusion CFL. Include a GPU status/readback path for invalid interface relaxation, non-finite fields and transport negativity.

Quantitative stamps need tanh tails with width W0, correct local liquidus admission, and no bulk changes to pore/mold identity. Keep the display and measurement phase convention unchanged.

## Conservative alloy transport

Let `A(psi)=1-(1-k)psi`, `B(U)=1+(1-k)U`, and `c_l_ref=c0/k`. Then the stored concentration is `c=c_l_ref A B`. Compute U from old psi and c at each sample.

The 2D implementation advances U with the old A and reconstructs c with the new A. Expanding those products leaves finite-step cross terms; its telescoping face current therefore does not make the complete concentration update exactly conservative. Preserve 2D behavior in this milestone, but do not clone that finite-step defect into 3D.

For 3D, construct one oriented face flux from old fields, then update concentration directly:

```
F_face = c_l_ref (1-k) [Dtilde q_face grad(U)_normal + j_at_face]
c_new = c_old + dt div_faces(F)
U_new = U(psi_new, c_new)   // reconstructed when needed, not stored
```

Use arithmetic face averages of `q=1-psi`. Evaluate anti-trapping with both cells' phase increments and both transverse gradients. An x-face uses the x-normal difference and averaged y/z central differences at its endpoints. Twelve unique edge neighbors in addition to the six face neighbors suffice per cell: a 19-point phase sampling footprint, not twelve unique new taps per face. Share a gradient floor/gate with flux evaluation.

The anti-trapping prefactor uses mean `W0`, while phase energy and relaxation retain cubic orientation dependence. This is the small-anisotropy approximation discussed in [EFKP section IV.5](https://arxiv.org/html/cond-mat/0404164#S4.SS5), not an exact orientation-dependent anti-trapping width. The calibrated scope is smooth, weak cubic anisotropy; this approximation does not support arbitrary strong anisotropy or faceted growth.

Every face is evaluated in a canonical orientation so adjacent cells use the same arithmetic and opposite divergence signs. Explicitly return zero flux at domain, mold and pore boundaries. A pore's `psi=0` must not make it look like a liquid transport cell. Account separately for any physical source/sink; there is none in the closed-box conservation test. Do not hide unstable transport with a concentration clamp that changes total mass.

`Stats3` has no spare header slot: its eighth word is Niyama risk and `counts[0]` carries measured-Niyama count. Add a separate float reduction/readback for quantitative concentration mass and diagnostic extrema. Validate it against a CPU double-precision sum of the actual `readSoluteVolume` values. Do not alias an existing diagnostic to avoid growing a buffer.

The implemented `readQuantitativeMass()` uses 256-lane workgroups, a balanced eight-addition FP32 tree per sample, and separate 32-byte partials containing sum, extrema and integer counts. JavaScript doubles sum partials in increasing linear workgroup order. Its `mass` is the concentration sample sum; multiply by `dx^3` for a volume integral. `count` includes all sampled voxels, with non-finite and negative counts reported separately. The partial and staging buffers together add about 1.69 MiB at 192^3. A new pore preserves the already computed conservative concentration; it must not overwrite that value with the old concentration after adjacent cells received its face current.

`readQuantitativeStatus()` reports sticky flags and the smallest positive interface relaxation factor. Flags identify invalid alloy relaxation, local phase CFL refusal, non-finite phase, unsupported concentration, or temperature outside the supported range. Hot liquid without an interface is allowed to cool toward the admitted range. Reset clears the ledger and status; the app polls on the panel cadence and restores Kobayashi with the visible reason after refusal.

## Memory and failure behavior

The current baseline textures cost 57 bytes/voxel. Auxiliary adds 8, alloy adds 8, and a later heat-treatment eligibility mask adds 4:

| Grid | Baseline MiB | Phase auxiliary MiB | Alloy pair MiB | Baseline + both MiB |
|---|---:|---:|---:|---:|
| 96^3 | 48.09 | 6.75 | 6.75 | 61.59 |
| 128^3 | 114.00 | 16.00 | 16.00 | 146.00 |
| 160^3 | 222.66 | 31.25 | 31.25 | 285.16 |
| 192^3 | 384.75 | 54.00 | 54.00 | 492.75 |

These are texture payloads, not adapter memory requirements. Keep room for the 2D solver, renderer, staging buffers, browser and driver overhead. A full-volume CPU readback also allocates staging plus JavaScript arrays; run independent censuses sequentially, especially at 192^3.

A runtime switch is transactional: pause stepping, await outstanding work, allocate auxiliary/alloy resources in error scopes, compile/create bind groups, and publish the mode only after all steps succeed. Destroy only newly allocated temporary resources on failure. Keep the current Kobayashi textures and casting alive; show the refused allocation and offer a lower grid explicitly. Do not invoke the destructive create-time grid rebuild as an invisible fallback. Guard concurrent toggles with a token/promise. Reset only after successful entry when the changed calibration requires a new initial field.

The core serializes quantitative and alloy preparations through one queue per GPU device, including distinct volume instances. Concurrent requests share their in-flight promise. Disabling alloy or destroying a volume invalidates pending publication; canceled candidate resources are destroyed, and an off/on sequence queues a fresh request with a new epoch. Bind groups and textures publish together only after validation and allocation scopes resolve.

## Active-mode integration

Keep an independent Kobayashi parameter snapshot for each dimension. `canCalibrate`, admission, lambda, the calibration stamp, unit bridge, liquidus reference, dials and plot metadata must read the solver that is actually active. An allocation failure must not leave a quantitative flag on Kobayashi dials. Apply alloy admission using the **active** volume chemistry and accepted phase-data bounds.

Share restore must ensure resources and recompute calibration before publishing a 3D quantitative state. Restore dimensional grid and cell pitch intentionally; never copy calibrated 2D dials into the volume by a shared material mirror. New controls need pending/disabled/reason states. Exports must identify dimension, solver, scope, seed, lambda, unit bridge and temperature approximation. Preserve latched identities of old datasets.

## Acceptance stages and pre-registered criteria

These thresholds are proposed acceptance targets, not measurements of the new solver. Record results at fixed seeds and grids before adjusting implementation. On a miss, refine dx/dt/domain or fix the formulation; do not widen a band to fit an output.

1. **Baseline/split:** exact field-byte agreement for pure/alloy Kobayashi at matched steps across free, Bridgman, weld, selector and lab/mold cases; identical pore/feed bookkeeping and CPU ID counts. Prove liveness through changed phase fraction/front displacement. Allocation-failure injection must leave original fields byte-identical and permit continued Kobayashi growth.
2. **Planar equilibrium:** tanh width within 2% of W0 at the refined setting, stationary zero-drive interface, and transverse-plane invariance. Repeat for x/y/z normals. This checks factors of two and dimensional transport without fitting a tip.
3. **Critical sphere:** isotropic imposed-temperature critical radius is `R*=2d0/Delta`, unlike a 2D circle. Stage radii on both sides (initially 0.92 and 1.08 times R*); verify opposite, resolved volume trends. Bracket the crossing within 8% at dx/W0=0.8 and within 5% after refinement. Include a cylindrical control with the one-curvature result to detect dimension mistakes.
4. **Pure heat/Stefan:** a planar one-dimensional sharp-interface reference embedded in a genuinely 3D field must match front position within 5% after interface/grid refinement; the insulated energy ledger `sum(T-latent*psi)` drifts by at most 5e-5 relative to its initial nonzero scale. Do not use the phase-field implementation itself to generate the reference trajectory.
5. **Cubic covariance:** 90-degree rotations/permutations of the same initial field preserve tip motion and field values to the independently measured discretization error. A non-grid-aligned orientation is also required to expose mesh anisotropy. Verify isotropic runs do not acquire a preferred crystal direction.
6. **Alloy partition/width:** extrapolate outer solid/liquid profiles to the moving interface, not arbitrary nearest cells. At fixed physical displacement in d0, demand k_eff within 10% of k with anti-trapping on. Require anti-trapping-off error to be larger than twice the on error plus a 0.005 absolute separation in at least one resolved case. Compare two interface widths at matched physical conditions; on-current k_eff spread must be below 10% of k. Failed liveness, interface clipping or boundary contamination invalidates the case.
7. **Closed-box concentration:** CPU concentration sum drift <=5e-5 after 10,000 resolved substeps, no non-finite/negative concentration, both AT on and off. Include nonuniform 3D fields, an oblique moving interface, and impermeable mold/pore faces. The reduction must agree with the CPU census within its separately measured summation error.
8. **Full 3D tip reference:** use a published 3D operating state only after checking temporal stationarity, domain size and dx/dt refinement. Start with a 10% target for P and sigma* against the published full-3D result below; report independent numerical-solvability values as a separate comparison. No claim of this gate passing until those contamination/convergence tests pass.
9. **Integration:** both dimensions retain their own solver and baseline dials; unsupported symmetry/material/allocation paths explain refusal; live UI, plots, share restore and complete-run archive agree about the actual active model. Finish the existing full GPU suite after the final source freeze.

## Independent literature and fixture evidence

[Karma and Rappel, PRL 77, 4050 (1996)](https://arxiv.org/pdf/patt-sol/9607005), Table I, PDF page 3, supplies actual 3D cubic data at undercooling 0.45. At epsilon4=0.0171 it reports P=0.312 and sigma*=0.063; at 0.0265, P=0.236 and sigma*=0.16. The independent numerical-solvability columns give (0.324,0.0578) and (0.247,0.142), respectively. The paper uses 200x200x400 lattices and grid-anisotropy corrections; its full-3D and axisymmetric columns are distinct. Local evidence: `verify-out/q3-kr96.pdf` and visually inspected `q3-kr96-table.png`.

Use `P=rho*V/(2D)` and `sigma*=2D*d0/(rho^2*V)` with the paper's local tip-radius definition; equivalently `rho/d0=1/(P*sigma*)` and `V*d0/D=2*sigma*P^2`. Never import the existing 2D velocity 0.017 as a 3D expected value. A small cube may not contain a steady needle plus its diffusion field; use boundary-distance checks or a carefully justified symmetry-domain/reference harness.

[Karma, PRL 87, 115701 (2001)](https://doi.org/10.1103/PhysRevLett.87.115701) is the dilute-alloy anti-trapping reference. [Echebarria et al., PRE 70, 061604 (2004)](https://arxiv.org/pdf/cond-mat/0404164), equations 8–11 and Appendix B, explicitly separates concentration conservation, anti-trapping, face discretization and a temperature-dependent relaxation time. The temperature factor is required for the port's externally driven alloy mode; it does not itself establish a model of coupled physical heat and solute diffusion.

The implemented harness consists of `scripts/verify-passsplit3d.mjs` for baseline equivalence, `scripts/verify-quant3d.mjs` for planar/sphere/partition/conservation, and the separate long-run `scripts/verify-quant3d-tip.mjs` with an independently sourced fixture JSON. Fixture metadata records source revision, phase-table version, seed, adapter, grid, dt, dx, boundary conditions, source/fixture hashes and measured liveness/convergence diagnostics.

The untouched fused source at revision `d59471e` has 390 raw golden field captures under `verify-out/q3-kob-original/manifest.json`. Repeating the original capture reproduced all 390 SHA256 values. A browser-free generated-source comparison also confirms that the refactored fused main-function expressions are token-identical to that revision, and checks generated binding uniqueness. The separate GPU split comparison and physical benchmarks are recorded below.

## Recorded GPU evidence

The following results were obtained on 2026-10-29 from the named scripts. Focused invocations explicitly marked other gates as skipped; these results do not represent one complete final regression-suite run.

| Check | Recorded result | Evidence |
|---|---|---|
| Original Kobayashi preservation | Refactored fused and diagnostic split each reproduced all 390 original raw field hashes across eight live fixtures; zero mismatches or GPU errors. | `scripts/verify-passsplit3d.mjs`; `verify-out/q3-passsplit-first.log` |
| Allocation transactions | Injected auxiliary-texture and bind-group failures preserved every original field byte, parameters and solute-pair identity, then allowed continued Kobayashi evolution. Concurrent quant/alloy requests deduplicated; off/on canceled stale publication; successful quantitative continuations had flags 0. | `PASSSPLIT3-ALLOCATION`; `verify-out/q3-passsplit-allocation.log` |
| Planar equilibrium | All three coordinate normals had fitted width about 0.99687 W0 and drift below 2.1e-5 cells after 2,000 steps, with zero transverse variation. | `QPF3-EQUIL`; `verify-out/q3-physics-initial.log` |
| Sphere and cylinder curvature | Estimated sphere critical-radius errors were 1.98% at dx/W0=0.8 and 1.56% at 0.4. The one-curvature cylindrical control differed by 1.80%. Both sides of every bracket moved in the predicted opposite directions. | `QPF3-GIBBS-THOMSON`; same log |
| Insulated pure heat | The 10,000-step energy-ledger relative drift was 5.38e-6, with live phase evolution. | `QPF3-ENERGY`; same log |
| Crystal orientation | Isotropic results were identical for changed quaternions. Cubic 90-degree agreement was within 1.2e-7 in phase, while a 30-degree crystal rotation produced a live, different field. This establishes crystal symmetry response, not arbitrary spatial-rotation or mesh-anisotropy convergence. | `QPF3-COVARIANCE`; same log |
| Reflection boundaries | A centered 64-cube and its 32-cube positive octant agreed within 5.96e-8 in phase and 1.79e-7 in temperature at steps 1,17,64. The planted old clamped-normal operator differed at the symmetry faces by 1.74e-4, 2.65e-3 and 7.76e-3. All six independent linear-flux face probes returned phi=0.501 within 1.29e-8; the old operator returned 0.5005. | `QPF3-BOUNDARY`; `verify-out/q3-boundary.log`; `q3-boundary-result.json` |
| Stefan motion | Travel error against the independent similarity solution fell from 2.01% at dx/W0=0.8 to 0.934% at 0.4 over about 60 tau0. | `QPF3-STEFAN`; `verify-out/q3-physics-alloy.log` |
| Closed-box alloy mass | All four 10,000-step combinations of AT on/off and mold/no-mold used a nonuniform oblique 3D field and pore. Relative concentration drift ranged from 7.6e-7 to 6.0e-6; GPU reduction versus CPU sum differed by 1.6e-9 to 4.5e-9. No negative or non-finite concentrations occurred. | `QPF3-MASS`; same log |
| App integration | Eight completion checks passed, including rapid pending-lambda coalescing, live pure 3D flags 0, independent mode parameters/pitch, calibrated setup links and Kobayashi restoration, unsupported-symmetry refusal, imposed-alloy export, composed-mix round trips, unsupported-steel withdrawal and visible unresolved Fe-Si/Mg-Zr phase panels. | `scripts/verify-completion-gpu.mjs`; `verify-out/q3-completion-final.log` |

The first partition/width fixture at Ttilde=0.55 failed the existing acceptance bands. Its lambda=6 runs reached tau(T)V/W about 0.46 with AT and 1.18 without AT; the far-field and matched-travel checks also failed. Those results are retained in `q3-physics-alloy.log`; they do not validate quantitative partitioning.

The reflection comparison exposed a separate boundary defect before the final suite: scalar fields and the anisotropic scalar weight have even ghosts, but the normal component of the anisotropic correction A must have an odd ghost. The quantitative phase pass now uses the actual flux-texture dimensions to reflect each of the six normal components. The centered-cube comparison and manufactured `div(A)=1` probes falsify the original clamped-A operator by removing only the marked fix. The corrected quantitative boundary does not alter the legacy operator: both fused and split Kobayashi still matched all 390 original raw hashes afterward (`verify-out/q3-passsplit-boundary.log`).

The first long-domain rectangular rerun at Ttilde=0.9, dx/W0=0.4 and 120 d0 travel matched within one substep produced AT-on k_eff values 0.15122 and 0.15077 for lambda 3 and 6. Both nominal tau0 V/W values were below 0.1, far fields were undisturbed, and transverse invariance was exact. However, the largest AT-off error was only 0.00482: that invocation failed the original negative-control separation requirement (`verify-out/q3-at-rect.log`). Its raw exponential liquid extrapolation and linear solid-history fit also retained a small diffuse-mixture bias. These failed measurements remain part of the audit history.

The accepted redesign selected its drive from the independent one-sided solute Stefan problem before measuring partition. With `ci=c0/k*[1-(1-k)T]`, mass balance gives `Omega=(ci-c0)/[(1-k)ci]=sqrt(pi)*beta*exp(beta^2)*erfc(beta)` and front velocity `V=2*D*beta^2/s` at displacement `s`. Targeting nominal `V*tau0/W=.08` at lambda=6 and `s=120*d0` gives beta=0.4336517346 and Ttilde=0.8692701173245906. Lambda 3 uses the same temperature, chemistry and physical displacement. Each arm uses a 1024x8x8 domain, dx/W0=0.4 and half the smaller thermal/local-phase timestep bound. The final crossing is one substep; both nominal and local velocity ratios must remain below 0.1 at measurement. Twelve raw cube comparisons of state, IDs, concentration and age first prove the rectangular shader specialization agrees exactly with production `Sim3D`.

The metrology now divides out the model's known mixture factor `A=1-(1-k)psi`, fits an erfc liquid profile using the measured time, initial interface position and known diffusivity, and fits the leading solid-history correction against inverse displacement. Fixed outer windows 5–9, 6–10 and 7–11 W0 are all tested. Analytic erfc/tanh-mixture/history controls recover imposed partition values, including a deliberately wrong k_eff=0.18; an oscillatory invalid profile fails the residual check. Independent erf reference values agree within 1.4e-7. Window spread is limited to 0.0015 and normalized profile residuals to 0.005. The original 10% partition and width bands and `off_error > 2*on_error + 0.005` requirement are evaluated at the worst window, without widening a band.

The final focused partition invocation passed (`verify-out/q3-at-stefan-target.log`; raw profiles in `verify-out/quant3d-result.json`):

| lambda | AT | k_eff, central window | All-window range | Nominal tau0 V/W | Local tau(T)V/W | Steps |
|---|---|---|---|---|---|---|
| 3 | on | 0.1499877 | 0.1499795–0.1499901 | 0.02056 | 0.005369 | 502,585 |
| 3 | off | 0.1557122 | 0.1550400–0.1558656 | 0.02116 | 0.005526 | 487,793 |
| 6 | on | 0.1497604 | 0.1497368–0.1497730 | 0.08187 | 0.021377 | 62,252 |
| 6 | off | 0.1601655 | 0.1594594–0.1604933 | 0.08463 | 0.022099 | 59,919 |

The lambda=6 negative-control error is at least 0.009459 across windows, exceeding the required `2*0.0002632+0.005=0.0055264`. All arms had finite nonnegative concentration, zero transverse variation, far liquid 0.3000000119 and matched travel within a single substep. The partition gate took 134.2 seconds on the recorded adapter. The 10,000-step closed-box mass criterion is separate: these longer partition trajectories record their own CPU mass drift and do not establish the same 5e-5 band after hundreds of thousands of substeps.

The earlier throughput/liveness runs did not constitute a literature tip benchmark. The complete campaign recorded below now supplies five runner-qualified operating windows, but misses the literature-reference acceptance bands. Arbitrary spatial-rotation covariance and full mesh calibration also remain distinct from the crystal-symmetry check above.

## Independent lattice diagnosis and revised long-run protocol

The first five-arm cloud study used revision `ad96166`, real NVIDIA RTX 5090 WebGPU, nine matching production/specialized field-hash comparisons and zero device errors. All five arms stopped during startup under the original instantaneous D/V clearance proxy; none reached an accepted operating state. Eleven shared base/domain checkpoints were exactly identical, so different proxy verdicts did not demonstrate actual boundary contamination. Those runs establish neither agreement nor disagreement with the published steady reference.

Protocol v3 keeps the original physical coefficients and accuracy bands. Its geometry and horizon cover the original 10% reference band prospectively, using `Vmin=.9^3 Vref`, `rhomax=rhoref/.9^2` and `tmax=8D/Vmin^2`. It records direct temperature patches on all three far faces and raw phase brackets for independent reprocessing. Startup D/V remains a diagnostic. Final acceptance still requires stationarity, resolved curvature, six conservative diffusion lengths of travel, and eight conservative lengths of clearance at EVERY retained steady-window sample. Domain/dx/dt/width convergence and uncertainty-inclusive reference comparisons remain mandatory.

A separate fixed-volume equilibrium experiment exposed a substantial lattice anisotropy in the original 7-point scalar stencil. At n=96, dx/W0=.8, initial R/W0=20, lambda=4 and a fixed 1,000 tau0 horizon, uniform-temperature volume feedback produced stationary, resolved Wulff shapes. Local support fits at [100]/[110] infer epsilon; [111] is held out. The feedback controls volume only and supplies no fitted energy coefficient. Both methods used identical initial conditions, metrology, horizon and stationarity criteria, without fitting delta to a dendrite outcome.

| Scalar stencil | Raw epsilon | Measured effective epsilon | Geometry uncertainty | Effective d0/W0 |
|---|---:|---:|---:|---:|
| Original 7-point | 0 | -.002816782 | .0000128 | .21897633 |
| Original 7-point | .0171 | .013569171 | .0000231 | .21886903 |
| Isotropic 19-point research candidate | 0 | -.000101146 | .0000248 | .21836795 |
| Isotropic 19-point research candidate | .0171 | .016602039 | .0000483 | .21820485 |

The 19-point candidate reduces the isotropic-case bias by about 28 times and the requested-anisotropy error from 20.65% to 2.91%. It is still a second-order method with residual mesh and finite-width error. The continuum d0/W0 is .8839/4=.220975; finite-radius effective d0 is report only. These equilibrium measurements do not establish kinetic cancellation or a stationary needle. Existing a(n)^2 relaxation retains leading continuum beta cancellation; discrete coupled-heat beta requires a separate outer-temperature measurement if a kinetic correction is proposed. No lattice coefficient is inferred from needle P or sigma.

Artifacts include `verify-out/q3-cloud-wulff-result.json` and `q3-cloud-wulff19-result.json`, with complete histories, source/candidate hashes, metrology controls, hardware and zero-error reports. The checksum-verified cloud archive also preserves the original failed five-arm study. These measurements motivate the quantitative-only stencil change and its subsequent regression/reference campaign; they do not mark Q3 complete.

## Completed five-arm reference campaign: not accepted

The protocol-v3 campaign at frozen revision `12ce78b3578d7dc3e7280b67987132791c3d4a71` completed all five arms on actual NVIDIA RTX 5090 WebGPU. Nine production/specialization field pairs matched exactly. Device errors were empty. Every arm met the runner's independent stationarity, metrology, retained-window clearance and travel criteria; none met the uncertainty-inclusive 10% literature-reference comparison.

| Arm | P | sigma* | sigma* point error against .063 |
|---|---:|---:|---:|
| Base | .32788026 | .05133256 | -18.52% |
| Larger domain | .32705244 | .05155458 | -18.17% |
| Finer dx | .33352871 | .05019442 | -20.33% |
| Half dt | .32694107 | .05158256 | -18.12% |
| Smaller interface width | .32535685 | .05293555 | -15.98% |

The pointwise domain/dx/dt/width changes in P, sigma*, rho/d0 and Vd0/D are all within the original 10% control band; their largest change is 3.12%. The final combined runner assertion nevertheless fails because every reference verdict fails. Do not describe that assertion as evidence that each comparative control itself missed its band. The larger-domain sigma differs from base by only .43%; this narrows the diagnosis without proving that all finite-domain effects are absent.

The [public numerical record](validation/quant3d-2026-10-30.json) retains configurations, actual terminal times, source hashes, hardware, uncertainty/drift budgets and individual verdicts. A separate NumPy polynomial/QR replay of ten raw base checkpoints reproduces P and sigma* to better than 5e-8 relative. The miss is not removed by different fitting arithmetic.

Protocol v3 chooses the FIRST reference-blind qualifying window within a fixed maximum horizon; it does not enforce an exact common terminal time across arms. Independent CPU controls demonstrate that early qualification does not establish later persistence or the final combined precision budget. A future study should predeclare one common physical terminal time and terminal window, preserve all the current bands, and judge that endpoint even if an earlier window was favorable. Waiting until the reference comparison passes would make endpoint selection depend on the expected result and is not acceptable.

Independent coupled traveling-wave CPU diagnostics completed 58 sparse solves with checked Jacobian and phase-energy identities. They find mesh- and speed-dependent outer-temperature residuals, but do not resolve a unique coarse-grid zero-speed kinetic coefficient. Local equilibrium-curvature fits also differ from the support-ratio fourth-harmonic prediction, with finite-radius, width and reconstruction effects still inseparable. Neither diagnostic identifies a unique correction or justifies fitting delta/tau to the observed needle result.

The next scientific target is therefore independent discrete capillary/anisotropy and coupled kinetic calibration, or further justified interface/grid refinement, followed by the fixed-terminal reference campaign. The analytical and app checks do not supersede the failed reference gate. Q3 stays in draft and is not promoted to production; the independent readout/phase-data release is separate.

The scientific-only raw evidence is backed up in an [unpublished draft evidence release](https://github.com/fronkt/solidify/releases/tag/untagged-3459ba2aba6970fa4704). The archive is 249,914,660 bytes, SHA256 `e12246766121b1eeed12985a84d84764528f7148210b6216f1491f51d6626eac`. All 179 tip checkpoints, 102 equilibrium checkpoints and pinned source hashes were verified; all 185 members of the diagnostic superset were also checked. The owned cloud instance was destroyed and API absence verified. Estimated compute cost was $0.765, excluding transfer/storage charges.

Final regression review: all 35 registered scripts passed across the reviewed full run, an unmodified responsive-driver retry, and a 12-script corrective continuation with source/test hashes unchanged. The first responsive run had an unreproduced CDP timeout; no assertion or timeout was relaxed. Both Intel/NVIDIA equilibrium runs and all analytical/alloy checks passed independently. The five-arm reference miss remains a separate failed gate, so none of this promotes Q3.
