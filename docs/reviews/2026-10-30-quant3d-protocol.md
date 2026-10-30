# Independent protocol4 audit

Reviewed revision: `2bd78939bc00f7aa5484cd815e870dcd6ec2d95a`.
Isolated worktree: `C:\Users\frank\solidify-review-protocol`.
The tracked source is unchanged (`git status --short` and `git diff --stat` empty).
No browser, GPU, cloud workload, source edit, commit, or push was performed. Dependencies were installed only in this isolated worktree with `npm.cmd ci`. Node: v24.14.0.

## Findings, ordered by severity

### 1. P1: A failed final GPU error-ledger read becomes a clean successful study

Location: `scripts/verify-quant3d-tip.mjs:315`, propagated through lines 320-326 and 329.

`page.evaluate(() => window.__solidifyTipDeviceErrors ?? []).catch(() => [])` makes a CDP/evaluation failure indistinguishable from a successfully read empty ledger. At this point all five arms can already pass. `tipOverallAcceptance` receives `errors: []` and no execution exception, writes `accepted: true`, and the runner exits 0. A lost page/context or failed error-reporting channel therefore removes required evidence instead of refusing the study. The `?? []` also permits a missing ledger to look clean.

Minimal CPU reproduction, from the isolated worktree:

```powershell
$env:Q3_MOCK_MODE='ledger-fail'
node --import ./verify-out/audit-preload.mjs scripts/verify-quant3d-tip.mjs verify-out/mock-ledger-fail 5199 --run
$LASTEXITCODE
```

The frozen preload overrides only Puppeteer's `launch` with an in-process fake. The actual runner and imported protocol/analysis execute unchanged. It returns finite paraboloid samples with predeclared constant radius and speed so the ordinary positive gates can pass; no evolved physics is claimed. Only the final ledger query throws `manufactured error ledger unavailable`.

Observed: exit 0; `verify-out/mock-ledger-fail/quant3d-tip-result.json` has `accepted: true`, `errors: []`, `failures: 0`, and `overallAcceptance.executionFailed: false`.

Control: `Q3_MOCK_MODE='gpu-error'` returns a readable one-element GPU ledger and correctly yields `accepted: false`, exit 1. Thus this is specifically the missing-evidence path, not inability to refuse a reported device error.

Required regression/refusal: inject a rejected final ledger query and a missing ledger independently; both must leave a persisted refusal reason and exit 1. Absence of evidence must not be represented as a checked empty ledger.

### 2. P2: Failure of the final queue-completion/destruction barrier is ignored

Location: `scripts/verify-quant3d-tip.mjs:314`; the called `scripts/fixtures/quant3d-tip-driver.mjs:210` awaits `device.queue.onSubmittedWorkDone()` before destruction.

The runner suppresses every exception from `__q3tip.destroy()`. Because this operation also contains a GPU completion barrier, the suppressed failure can be more than harmless resource cleanup. It is not persisted as an exception or an error, and can still produce a fully successful verdict.

```powershell
$env:Q3_MOCK_MODE='cleanup-fail'
node --import ./verify-out/audit-preload.mjs scripts/verify-quant3d-tip.mjs verify-out/mock-cleanup-fail 5199 --run
```

Observed: the fake fixture's final `destroy()` throws `manufactured queue completion failed`; the unmodified runner writes `accepted: true`, empty errors, zero failures, and exits 0. Witness: `verify-out/mock-cleanup-fail/quant3d-tip-result.json`.

Required regression/refusal: inject rejection of the completion barrier separately from an ordinary resource-destruction error; persist either failure. Do not advertise completed error-free execution when that barrier failed. Scientific point estimates need not be changed.

### 3. P2: Initialization exceptions bypass the result artifact and can preserve a stale accepted result

Location: `scripts/verify-quant3d-tip.mjs:174-182`; the protected execution starts only at line 188, after Chrome launch and `newPage`.

Both launch and new-page failures escape before `result`, `save`, and the catch/finally lifecycle exist. A fresh output directory contains the new contract but no `quant3d-tip-result.json`. A reused output directory retains its previous accepted result without marking it stale or replacing it with this run's initialization failure. Process exit is correctly nonzero, but the saved verdict does not represent the latest invocation.

Fresh-output reproduction: use `Q3_MOCK_MODE='launch-fail'` or `'newpage-fail'` and output `verify-out/mock-launch-fail` / `verify-out/mock-newpage-fail`. Both exit 1 and have no result JSON.

Stale-result reproduction:

```powershell
$env:Q3_MOCK_MODE='positive'
node --import ./verify-out/audit-preload.mjs scripts/verify-quant3d-tip.mjs verify-out/mock-positive 5199 --run
$before=(Get-FileHash verify-out/mock-positive/quant3d-tip-result.json -Algorithm SHA256).Hash
$env:Q3_MOCK_MODE='launch-fail'
node --import ./verify-out/audit-preload.mjs scripts/verify-quant3d-tip.mjs verify-out/mock-positive 5199 --run
$LASTEXITCODE
$after=(Get-FileHash verify-out/mock-positive/quant3d-tip-result.json -Algorithm SHA256).Hash
$before -eq $after
```

Observed: latest invocation exits 1, but hash equality is true and the artifact still says `accepted: true`, `status: "long 3D tip accepted"`. Witness artifact SHA256: `a4915c2bb1d9a9f20821208dedc6bde57c1fa517148e832aa2b051fd18df7744`.

Required regression/refusal: initialize and persist this run's unaccepted result before fallible launch/setup; retain the exception, execution identity, and nonzero exit even when no page exists. Test both a fresh output and a reused previously passing output.

### 4. P3: Final status can contradict the actual acceptance verdict

Location: `scripts/verify-quant3d-tip.mjs:307-308`, `316-326`.

`status` is set before the final error collection, while `accepted` is recomputed afterward. Only a nonempty device ledger explicitly revises status. A page error arriving during final evaluation can produce a saved refusal and nonzero exit while retaining `status: "long 3D tip accepted"`.

```powershell
$env:Q3_MOCK_MODE='page-error'
node --import ./verify-out/audit-preload.mjs scripts/verify-quant3d-tip.mjs verify-out/mock-page-error 5199 --run
```

Observed in `verify-out/mock-page-error/quant3d-tip-result.json`: `accepted: false`, error `manufactured page exception`, exit 1, but accepted status text. Boolean/exit gates are correct on this path; the textual artifact is contradictory.

Required regression: inject a late page error after all arm/control verdicts pass and assert consistent final status, saved verdict, and exit code.

### 5. Qualified P2 claim gap: Three fitted speeds do not bound every observed interval speed

Location: `scripts/fixtures/quant3d-tip-analysis.mjs:136-146`; broad wording in the comment at lines 141-144 and `scripts/verify-quant3d-tip.mjs:78`.

The velocity-variation guard uses only three overlapping four-sample regression slopes. Consequently the statement that full retained-window velocity variation is limited independently of uncertainty, including oscillations, is stronger than the guard establishes. It does enforce the narrower bound on those three fitted slopes.

Small direct reproduction:

```powershell
node verify-out/velocity-oscillation-probe.mjs
```

At cadence 20, use `tip_i = 10 + .13*t_i + .052*(-1)^i`, tip error `1e-4`, constant rho 12 and rho error .01. Every position is monotonically increasing, and the timing is valid. The nine observable adjacent-interval speeds alternate between .1248 and .1352: an 8% peak-to-peak variation relative to .13. The three fitted speeds are .12896, .13104, .12896. The runner reports variation 1.6043%, below its existing 2.5% input budget, marks the terminal state stationary/resolved, and accepts the nominal steady target with uncertainty-inclusive reference budgets below 4.45%.

This is a temporal-resolution/definition counterexample, separate from the already acknowledged surface-model uncertainty issue. It does not prove that published steady kinetics requires instantaneous or sub-cadence velocity stationarity, nor that the three-window definition itself was implemented incorrectly. Either narrow the claim explicitly to the three fitted speeds, or prospectively define and test a temporal refusal rule that covers the intended class of observable oscillations. Do not choose such a rule from agreement with the desired needle value or widen a band.

Actual archived BASE impact was checked read-only as requested. In main checkout `verify-out/q3-cloud-cont-base-progress.json` (SHA256 `3f77b69e4111abccdbe25b2b40937c30860c0b8f341b8a68a8260ed87cbc81e3`), the final ten canonical `steps*dt` observations give interval speeds .1245815221-.1246321650, range/fitted speed 0.0406388%. Reported three-window variation is 0.0434438%; both are far below 2.5%. Incorporating tip-error interval bounds leaves no positive lower bound on this tiny range. No actual impact of the synthetic temporal gap is demonstrated for this archived BASE sequence. This artifact already refuses the arm and full study. Details: `verify-out/archived-base-velocity-probe.{mjs,json}`.

## Requirements verified

The prescribed CPU command passed, exit 0:

```text
node scripts/verify-quant3d-tip.mjs verify-out/independent-protocol 5199 --self-test
```

Extra probes: `node verify-out/protocol-probes.mjs`; results retained as `verify-out/protocol-probes.json`.

- The target horizon and cadence are explicit constants. Static dependency review and the existing perturbed-reference controls show P/sigma reference changes change comparison outcomes without moving declared observation times.
- All registered arms declare physical endpoint 1949.1356423198636, with 61 checkpoints and exactly ten retained checkpoints. Each registered requested checkpoint rounds upward independently; all rounding errors are nonnegative and strictly below the corresponding dt. Actual rounded endpoints are below.
- Width arm scaling is internally consistent: W0 ratio .9, tau0 ratio .729, solver-time ratio `(4/3.6)^3`. Initial radius, physical extents, capillary length, and physical diffusivity match the base. Point comparisons use dimensionless P, sigma, rho/d0 and V*d0/D.
- Terminal samples are selected by exact declared integer substeps, then canonical `steps*dt` replaces the reported clock for fitting. Missing final/interior retained samples, duplicated retained samples, observations outside the schedule, an unfinished/overshot endpoint, NaN clock, and one-dt clock error all refuse acceptance. The registered sequential-FP64 clock bound is much smaller than one substep.
- Non-finite/missing curvature fields cannot obtain a resolved/accepted state. Such direct malformed-helper inputs can still have `complete: true` (timing completeness), which is separate from scientific resolution.
- Early unresolved or duplicated samples outside the final ten do not change the retained terminal result. This is consistent with the declared final-ten policy; it is not a claim that all earlier samples are scientifically resolved.
- The existing late-radius-drift control is rejected even with exact reference point agreement, a resolved state, and an earlier qualifying window. Early qualification does not select or replace the final window.
- Boundary controls refuse the earlier unclearance even when the last sample clears; the boundary routine checks every retained sample and uses the lower fitted velocity and upper geometry bounds. Startup diffusion-length diagnostics do not trigger an early abort.
- The actual runner under a passing CPU base-only fixture exits 0 while saving arm accepted=true, overall accepted=false, controlsConverged=null, and diagnostic status. It reports full convergence/acceptance as NOT-EVALUATED. A passing subset cannot become full-study acceptance.
- Full five-arm positive, duplicate/missing-arm, false-control, explicit execution-failure, and explicit GPU-error inputs behave correctly at `tipOverallAcceptance`. A readable GPU error causes persisted refusal and exit 1 in the actual runner.
- A manufactured runtime exception after arm setup is caught, persisted with `overallAcceptance.executionFailed: true`, and exits 1. Fixture: `verify-out/audit-execution-fail-preload.mjs`; witness: `verify-out/mock-execution-fail/quant3d-tip-result.json`.
- Pointwise control convergence is separate from all-arm reference acceptance. A failed reference leaves the independent controls verdict intact and cannot pass the combined gate.
- Raw sample files are written before reconstruction, with relative paths and SHA256; contract/geometry/terminal controls are written before browser initialization. The artifact failures above concern the result lifecycle, not this raw-snapshot ordering.

| Arm | terminal steps | rounded physical endpoint | maximum physical rounding |
|---|---:|---:|---:|
| base | 108282 | 1949.1446291316 | .0180006338 |
| domain | 108282 | 1949.1446291316 | .0180006338 |
| dx | 192501 | 1949.1412540127621 | .0101253565125 |
| dt | 216564 | 1949.1446291316 | .0090003169 |
| width | 148535 | 1949.1448991411066 | .0131224620402 |

## Known equilibrium readback issue: impact verified, not a new finding

`src/sim3d.ts:1174-1177` uses `bytesPerRow = n*8` without padding in `readStateVolume`. At the matrix's n=144, this is 1152, which is not divisible by the required copy-row alignment 256. n=96/128/192 produce aligned rows 768/1024/1536. The tip fixture's independent `readTexture` at `quant3d-tip-driver.mjs:33-44` already pads rows correctly and is unaffected by this particular bug.

`research/quant3d-equilibrium-driver.mjs:79` requires this readback for the initial measurement before evolution; therefore both n=144 radius cases are inadmissible as complete runs and supply no evolved radius-control evidence. Their runner catches a case error, marks it incomplete, and continues. `research/quant3d-equilibrium.mjs:96-102` requires every selected case complete and no global errors, so twelve completed cases cannot make the full fourteen-case invocation successful. The presence of a runtime validation error further refuses the run. No cloud output was independently reverified here; this is the source-level admission impact of the already known defect.

## Acceptance evidence still missing

- This audit runs CPU controls and synthetic plumbing only. It does not supply a new fixed-terminal five-arm GPU campaign or any literature acceptance evidence. The documented v3 five-arm reference failure remains a failure; the inspected v4 archived BASE is diagnostic and also fails its arm comparison.
- The acknowledged smooth non-polynomial radius-uncertainty undercoverage remains unresolved. Supplemental main-checkout metrology documentation was read separately; its controls are not present at the reviewed 2bd7893 revision and are not conflated with that source. Polynomial replay and a small number of stable compact fits do not certify model-form coverage. This is not counted as a newly found defect.
- Independent known-truth controls should include smooth sub-window crossover surfaces, fourfold morphology, Float32 interpolation/subcell shifts, and temporal trajectories that test whichever stationarity definition is actually claimed. Estimator/model choices must be declared independently of agreement with the paper. Until an applicable model-form bound or justified refusal rule is established, a future runner-qualified window alone cannot substantiate a generally uncertainty-certified radius claim.
- The matrix's missing radius cases and equilibrium limits cannot establish moving-interface kinetic cancellation, a unique coarse-grid correction, or acceptance of needle P/sigma. No physical coefficient, observation schedule, or error threshold was changed in this review.

## Reproduction inventory

`verify-out/audit-preload.mjs` SHA256: `1d553a17c403c20db390b666a102567deda32b3ee5e986c6c0c52dbe9594d3c2`.
`verify-out/velocity-oscillation-probe.mjs` SHA256: `f1d820ec66182f2efede73fe940d48591c1a0d2287d9892878f21f2a5f56dc39`.

Mock modes: `positive`, `ledger-fail`, `cleanup-fail`, `gpu-error`, `page-error`, `launch-fail`, `newpage-fail`. The mock file was frozen after the first batch; supplemental exception injection is in a separate preload. `mock-*.log`, corresponding result JSONs, `protocol-self-test.log`, `protocol-probes.json`, `velocity-oscillation-probe.json`, and `archived-base-velocity-probe.json` remain under ignored `verify-out/`. All invocations use this isolated worktree as working directory.

