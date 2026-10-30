# Quantitative 3D solidification: implementation and acceptance contract

Design checkpoint: 2026-10-29. The core and active-mode integration are implemented in the working tree and await GPU validation. The acceptance targets below are not measured results.

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

Use W0 and tau0 as solver units. Reuse the physical calibration for d0, W0, tau0 and the temperature reference, with dimension-aware timestep selection. The 7-point diffusion operator has an explicit stability edge `dt <= dx^2/(6 Dtilde)`. The 2D safety coefficient 0.15 is close to that edge in 3D; use a separately named 3D coefficient 1/12 as the initial half-edge margin, without changing 2D defaults. Reaction and anisotropy stability still require verification.

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

Planned harness: `scripts/verify-passsplit3d.mjs` for baseline equivalence, `scripts/verify-quant3d.mjs` for planar/sphere/partition/conservation, plus an independently sourced tip fixture JSON and documented long-run tip check. Browser-free calibration/face-flux arithmetic should be gated separately. Fixture metadata records source revision, phase-table version, seed, adapter, grid, dt, dx, boundary conditions and all measured liveness/convergence diagnostics.

The untouched fused source at revision `d59471e` has 390 raw golden field captures under `verify-out/q3-kob-original/manifest.json`. Repeating the original capture reproduced all 390 SHA256 values. A browser-free generated-source comparison also confirms that the refactored fused main-function expressions are token-identical to that revision, and checks generated binding uniqueness. Neither observation substitutes for the pending GPU split comparison or independent quantitative benchmarks.
