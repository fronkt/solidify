# quant3d-fp64-port: NumPy/CuPy port of the 3D tip fixture (fp32 vs fp64)

Research diagnostic only. It asks whether single precision biases the 3D
free-dendrite tip-selection benchmark (Karma and Rappel 1996; pure substance,
thin interface, lattice kinetics on). WGSL has no f64, so this independent
transliteration supplies the double-precision reference. Nothing here selects a
coefficient, estimator or reference band, and nothing changes the GPU code.

Files (all new):

| File | Role |
|---|---|
| `quant3d-fp64-port.py` | the port, fused CUDA/CPU kernels, CLI, `--self-test` (13 checks), `--box-gates` |
| `quant3d-fp64-port-selftest.py` | gates 1-4 (`gate1 --capture DIR`, `gate2`, `gate3`, `gate4 --work DIR`), `fused --capture DIR`, `box` |
| `quant3d-fp64-port-capture.mjs` | short WebGPU capture of the real WGSL fields for gate 1 |
| `quant3d-fp64-port-arms.json` | w40-anchor (LADDER_ARMS) and w28 (narrow-ladder 2026-11-24) configs for the probe and the cloud runs |

The WGSL capture used by gate 1, gate (b) and `--box-gates` is git-ignored:
`verify-out/fp64-port/capture/`, or the 3.8 MB state-only bundle
`verify-out/fp64-port/capture-states.tar.gz` (sha256 `c4bb3ee6...a501`).
Local fused validation venv: `D:\solidify\venv-fp64` (`pip install numpy==2.3.5
scipy==1.17.1 ziglang==0.17.1 nvidia-cuda-nvrtc-cu12==12.9.86
nvidia-cuda-nvcc-cu12==12.9.86`, the last only for `ptxas -v`), with `ZIG_GLOBAL_CACHE_DIR` and
`SOLIDIFY_FUSED_CACHE` set to directories on D:.

Source transliterated: `ab2b45c`. The worktree HEAD later moved to `4fbba7f`
(another session added `quant3d-tip-driver-slabbed.mjs` and paper-rows files),
but `git diff ab2b45c HEAD` is empty for every file the port reads:
`src/shaders3d.ts`, `src/shaders3d-quant.ts`, `src/sim3d.ts`,
`scripts/fixtures/quant3d-tip-driver.mjs`, `rect3d-specialize.mjs`,
`quant3d-tip-analysis.mjs`, `quant3d-tip-protocol.mjs`, the width-ladder
runner and model, and `quant3d-q3c-tip-replay.py`.

## Usage

```
# arm configs (LADDER_ARMS) as JSON
node --input-type=module -e "import { LADDER_ARMS } from './scripts/research/quant3d-width-ladder-model.mjs'; console.log(JSON.stringify(LADDER_ARMS))" > arms.json

python -I scripts/research/quant3d-fp64-port.py --self-test
python -I scripts/research/quant3d-fp64-port.py --config arms.json --arm w40-anchor --out OUT \
    --dtype float64 --backend cupy --dump-every 10          # full protocol schedule, 61 checkpoints
python -I scripts/research/quant3d-fp64-port.py ... --resume STEP   # restart at a dumped checkpoint
python -I scripts/research/quant3d-q3c-tip-replay.py --campaign port=OUT/samples --out replay.json
```

* `--dtype float32|float64`, `--backend numpy|cupy` (CuPy is imported only on
  request; the same `xp` code runs on both).
* `--inputs gpu` (default) rounds every uniform, every WGSL literal and the
  initial state to Float32 first, then works in the chosen dtype. A float64
  run therefore solves exactly the GPU's discrete problem and isolates
  arithmetic precision. `--inputs exact` uses the float64 config and literal
  values (gate 2 shows the input rounding alone moves phi by about 1e-7).
* `--steps N` (short tests; also writes a sample at N), `--max-checkpoints M`,
  `--schedule every:K`, `--dump-fields`, `--dump-at 1,17,64`,
  `--dump-every K` (restart points), `--resume STEP`,
  `--init-state state.npy` ((nz, ny, nx, 2) phi/T, for example a GPU
  readback), `--chunk-voxels V`.
* Output: `OUT/samples/<name>-<9-digit step>.json` with the harness schema
  `{source, config, time, steps, points, aheadBoundaryTemperature,
  phaseBracketSource, farFieldDiagnostics}` (the `source` and two descriptive
  strings name the port and dtype; all keys and the key order are the
  driver's). `OUT/port-run.json` is the manifest (dtype, inputs, uniforms in
  the working dtype, file hashes, per-checkpoint localTip, timings).
  `OUT/fields/*.npy` holds the dumps.
* Windows: the CLI opts its own process out of efficiency-core confinement
  (`SetProcessInformation`, ProcessPowerThrottling off; `--keep-power-throttling`
  disables this). Without it, measured throughput was 2-3x lower and bimodal.

## WGSL-to-Python mapping

Each WGSL substep is three dispatches (driver `advance`, lines 135-141): flux
from `state[dir]`, phase from `state[dir]` plus flux into `aux`, transport from
`state[dir]` plus `aux` into `state[1-dir]`. The port runs the flux pass over
all z-chunks, then fuses phase and transport per z-chunk, writing the
ping-pong pair. Fusing is exact because transport reads only this cell's
`aux` (`textureLoad(phiAux, c, 0)`) and the same old `state`.

| WGSL / JS (ab2b45c) | Python (`quant3d-fp64-port.py`) |
|---|---|
| driver `parameters()` 65-69, `DEFAULTS3D` sim3d.ts 134-171 | `driver_parameters` 85 |
| driver `fields()` 49-61 (`Math.hypot`, `Math.tanh`, Float32Array) | `initial_fields` 187, `v8_hypot` 94, `fdlibm_tanh`/`fdlibm_expm1` 122-185 |
| uniforms (Float32 `P3` slots), WGSL literals, const-folded `47.0/75.0`, `1321.0/9870.0` | `TipPort.K`, `_constants` 459-493 |
| `cid3` clamp; `rect3dSpecialize` bounds | `_zslab`, `_slab_xy`, `_nb` 500-516 (edge replication) |
| `FLUX3D_WGSL` shaders3d.ts 209-235: gph, g2, `g2 < 1e-12` branch, `gm = sqrt`, `nrm`, `aniso3` cubic 153-155, identity `qrotInv`/`qrot`, `tang`, `(e2 a gm) tang`, `e2 a a` | `_flux_chunk_body` 559-593 |
| `LOADS3` 246-266 + `quantLap3` 280-288 (18-point Laplacian, `QUANT_EDGES3` order) | `_lap18` 535, `EDGES3` 391 |
| `PHASE_ANISO3_CORE` 312-343: `gradW` (clamped), `QUANT-NORMAL-FLUX` reflected `divA`, `aniso` | `_phase_transport_chunk` 596-627 (`_cdiff`, `_rdiff`) |
| `QUANT_PHASE3` shaders3d-quant.ts 15-55: `q`, `well`, `drive = T - 1`, lattice `tauLoc` 29-36, flags 32/2/4, `react`, `raw`, clamp, `dPhi` | `_phase_transport_chunk` 629-686 |
| `phi3dWgsl` mask/PORE early exit 547-550 | not reachable (scen 0, ids never PORE) |
| `transport3dWgsl` + `splitTransport3` 575-585: `TNew = T + dt dTherm lapT + latent dPhi - dt cool + dt heat`, flag 16, clamp | `_phase_transport_chunk` 688-703 |
| driver `advance` clock (`time += batch * p.dt`, cap = floor(1.6e8/voxels)) 120-151, status flags throw | `TipPort.advance` 718, `run.clock` 908 |
| driver `sample()` 153-211 | `TipPort.sample` 747 |
| `phaseCrossing`, `lineFit`, `solve`, `surfaceFit`, `localTip` (quant3d-tip-analysis.mjs) | `phase_crossing_batch` 210, `js_line_fit` 246, `_js_solve` 276, `_surface_fit` 298, `local_tip` 354 |
| `fixedTerminalSchedule` (quant3d-tip-protocol.mjs 41-68) | `fixed_terminal_schedule` 55 |

Not ported, because they cannot affect phi or T on this path. The grain-id
claim, twin and pore logic: every quaternion is the identity, so `quats[id]` is
the same for any id; `twinProb = 0`, `pPore = 0`, and ids are 0 or 1, never
PORE. The age record (write-only). `fed` and `mask` (scen 0). The hash noise
(`noiseAmp = 0` makes the term an exact signed zero). The Kobayashi branch
(solver 1). `minTau` is reported as 1.0 once any cell is interface-active
(factor = 1).

Operation order follows the WGSL expression trees: left-associative,
`dot(a, b) = (ax bx + ay by) + az bz`, face and edge sums in source order,
`(e2 * a) * gm`, `((tau * 47/75) * lambda) / dTherm`, `((lambda * well) * well) * drive`.
No reassociation, no fused multiply-add, IEEE division and sqrt. In-place NumPy
ops are the same IEEE operations as their out-of-place forms.

## Boundary rule

Every neighbour read uses `cid3`: indices are clamped per component to
`[0, dims-1]`. For the 6 face and 12 edge neighbours this is edge replication:
an even mirror about the half-cell planes x = -0.5 and x = nx - 0.5 (cell
units), the same for y and z (`xp.pad(mode="edge")` on x and y, clipped
z-slabs on z). The dendrite axis therefore sits on the x = y = 0 corner line,
and the seed is an octant at the origin corner. The one exception is the
anisotropic correction A in the phase pass (`QUANT-NORMAL-FLUX`): its normal
component is odd under the mirror, so at a low face `aW = -fC.x` and at a high
face `aE = -fC.x`, and likewise for y and z (`_rdiff`). `gradW` and the scalar
stencils keep the clamped (even) values. The clamped 18-point Laplacian is
conservative: over 60 steps the self-test conserves sum(T - phi) to 1e-8
relative in f32 and to the precision of the float64 sum in f64.

## Gate results (2026-11-26, Intel Core Ultra 7 258V, NumPy 2.3.5)

Artifacts are in `verify-out/fp64-port/` (git-ignored): the capture, `gate1-4.json`
and the gate-4 run.

### Gate 1: faithfulness vs the real WGSL (float32 port) - PASS

Capture: `quant3d-fp64-port-capture.mjs`, Chrome 157.0.8103.79 headless,
Intel Arc 140V (`xe-2lpg`), Vite on 5297 from this worktree. The served
`src/shaders3d.ts`, `src/shaders3d-quant.ts`, `src/sim3d.ts`,
`rect3d-specialize.mjs` and `quant3d-tip-analysis.mjs` were byte-identical to
the worktree. The unmodified driver ran, and its own native-equivalence gate
gave 0 mismatches at 1/17/64 steps, with no device errors. The GPU job took
10 s. The only addition is a page hook that records the fixture's textures,
so state, flux and aux can be copied out.

Initial state: bitwise identical in all three fixtures. This needed V8-exact
`Math.hypot` and fdlibm `tanh`; with `np.tanh`, up to 11% of the f32 phi
values (corner fixture) differed by one ulp. The node check covered 1.53M
voxels and 3.5e5 tanh arguments.

| Fixture | Steps | max \|d phi\| f32 port vs GPU | max \|d T\| | max \|d phi\| f64 port vs GPU | max \|d T\| |
|---|---|---|---|---|---|
| eq32: driver `equivalence()` config (w50 physics, 32^3, centred r = 5) | 1 | 3.7e-9 | 0 | 3.6e-8 | 4.1e-8 |
| | 64 | 1.2e-7 | 1.2e-7 | 1.2e-7 | 3.6e-7 |
| | 1024 | 2.1e-7 | 2.4e-7 | 1.2e-6 | 6.3e-7 |
| | 4096 | 6.0e-7 | 2.4e-7 | 1.6e-6 | 5.7e-7 |
| corner: w40-anchor physics, 24x28x36, corner seed r = 8 | 1 | 6.0e-8 | 6.0e-8 | 3.6e-8 | 4.4e-8 |
| | 256 | 1.2e-7 | 1.2e-7 | 1.7e-7 | 7.1e-7 |
| | 1024 | 2.1e-7 | 1.8e-7 | 2.6e-6 | 1.4e-6 |
| | 4096 | 3.0e-7 | 2.4e-7 | 2.2e-5 | 1.9e-6 |
| corner-long: same physics, 40x40x64 | 1024 | 2.4e-7 | 1.8e-7 | 1.9e-6 | 1.9e-6 |
| | 4096 | 2.4e-7 | 1.8e-7 | 1.5e-5 | 9.7e-6 |
| | 8192 | 6.0e-7 | 2.4e-7 | 1.1e-4 | 1.4e-5 |
| | 16384 | 4.2e-7 | 1.8e-7 | 7.1e-5 | 8.9e-6 |

The worst f32 port-vs-GPU difference over all stops is 6.0e-7 (phi) and
2.4e-7 (T), a few ulp and 17x below the 1e-5 target. It does not grow
systematically through 16384 steps. The f64 port departs from the same GPU
trajectory by up to 1.1e-4, more than 100x the port's own faithfulness floor,
so the port resolves fp32-vs-fp64 effects cleanly. Tip radius from `localTip`
at 16384 steps (corner-long): GPU 38.7553765, f32 port 38.7553931 (+4e-7
relative), f64 port 38.7560864 (+1.8e-5). At 4096 steps (corner): 30.5605042,
30.5604723, 30.5598921 (-2.0e-5).

Bitwise identity of the whole field is not achieved: at 1024 steps, 55%
(eq32), 82% (corner) and 94% (corner-long) of cells differ by at least 1 ulp.
Per pass, at step 1 from the identical state:

* Flux: A components max 1.3e-8 / 1.9e-8 absolute; w = e2 a^2 differs by 2-3
  ulp in 4% / 2% of cells.
* Phase pass fed the GPU's own state and flux: eq32 10 of 32768 cells
  (max 2.3e-10); corner 938 of 24192 (1 ulp, max 6.0e-8).
* Transport pass fed the GPU's own aux: 0 mismatches (bitwise) in all
  fixtures.

Forensics. On this Dawn/D3D12/Intel path, division behaves as
reciprocal-multiply. Evaluating `dt/tauLoc` as `dt*(1/tauLoc)` cuts the eq32
phase mismatches from 10 to 1. Normalizing with `gph*(1/gm)` cuts the w
mismatches from 1320 to 776 (eq32) and from 445 to 272 (corner); the rest is
consistent with hardware reciprocal and sqrt approximations. Every fused
multiply-add variant tried (g2, the n^3 sum, a, the aniso dot, the raw update)
increased the mismatches, so there is no evidence of contraction. The
remaining corner phase mismatches are 1-ulp relative differences, mostly on
far-field tail values (phi from 1e-19 to 1e-7). No tested variant explains
them; HLSL permits reassociation without `precise`, which is the likely cause.
The port keeps IEEE semantics throughout and does not emulate the Intel
driver.

Metrology. `sample()` evaluated on the GPU's own state equals the GPU's
`sample()` JSON at every stop of every fixture: the same columns and zCell,
identical phaseBracket values, max \|d z\|, \|d zCoarse\| and \|d zRaw\| all 0,
identical far-field patches and aheadBoundaryTemperature, identical
patchTip/patchRho, and the same key order.

### Gate 2: float32 vs float64 port, cubic symmetry

w40-anchor physics, 32^3, corner seed r = 8, NumPy:

| Steps | f32-f64 max \|d phi\| | f32-f64 max \|d T\| (max is in the far field, phi < 1e-3) | f64 gpu-inputs vs exact-inputs \|d phi\| | axis-permutation asymmetry f32 | f64 |
|---|---|---|---|---|---|
| 0 | 0 | 0 | 3.0e-8 | 0 | 0 |
| 100 | 1.2e-7 | 3.5e-7 | 2.2e-8 | 1.2e-7 | 2.2e-16 |
| 200 | 1.3e-7 | 4.3e-7 | 3.9e-8 | 1.8e-7 | 3.3e-16 |
| 400 | 2.5e-7 | 6.8e-7 | 6.7e-8 | 2.4e-7 | 3.3e-16 |
| 600 | 6.7e-7 | 9.2e-7 | 9.1e-8 | 2.7e-7 | 4.4e-16 |
| 800 | 1.3e-6 | 1.4e-6 | 1.1e-7 | 3.6e-7 | 3.3e-16 |

The f32-f64 gap grows about 10x in phi between 100 and 800 steps, and at
every stop the largest T difference lies in the far field. One candidate
mechanism, not yet established: with T near 0.55 (ulp 6e-8), far-field
heat-diffusion increments of order 1e-8 per step round away in f32. In gate 1
(corner-long), the f64-vs-GPU difference grows to 1e-4 while the f32-vs-GPU
difference (two different f32 roundings) stays at about 5e-7. Pure
amplification of rounding noise by the interface dynamics would grow both.
That points to a systematic precision effect shared by both f32
implementations, with one caveat: the two differences are driven at different
strengths (every rounding versus the few percent that differ). Whether the
effect moves V and rho at the terminal state is what the full f64 arm
answers. The
seed is exactly cubic-symmetric at step 0 in both dtypes. The self-test also
checks: a y/z-invariant planar front stays bitwise invariant, z-chunked
evaluation is bitwise identical to unchunked, and enthalpy is conserved.

### Gate 3: throughput (single NumPy process, unthrottled)

| Grid | float32 voxel-steps/s | float64 voxel-steps/s |
|---|---|---|
| 48^3 | 7.6e6 | 6.9e6 |
| 64^3 | 1.28e7 | 9.8e6 |
| 96^3 | 2.0e7 | 1.05e7 |
| 270x270x612 (w40-anchor, measured 2 steps) | - | 4.9e6 (2-layer chunks; 11.5 days for the arm) |

The measured op count is 207 array operations per step: about 1.9 KB (f32) or
3.8 KB (f64) of array traffic per voxel-step. The CuPy path is untested here
(no NVIDIA GPU). It runs one IEEE operation per kernel; NVRTC defaults are
`prec-div`, `prec-sqrt`, no `ftz`, and no contraction across kernels, so it
should be bitwise identical to NumPy. Verify that on first use by running
`--steps 50` on both backends and comparing the dumps. Assuming 60% of peak
DRAM bandwidth, the estimate is about 5e8 voxel-steps/s in f64 on an H100 SXM
(about 2.6 h for the 4.83e12 voxel-steps of w40-anchor), about 3e8 on an A100
or RTX 5090 (4-5 h), and roughly half those times in f32. Kernel-launch
overhead adds about 20-40 min at 6 chunks per step; use one chunk on an 80 GB
card.

fp64 vs fp32 cost on a GPU for this code: about 2x for any bandwidth-bound
implementation (this port on any GPU, or a fused kernel on FP64-capable
datacenter parts, where FP64 runs at half the FP32 rate). A fused fp64 kernel
on consumer cards (FP64 at 1/64 rate) becomes compute-bound: about 400
operations, including 6-10 divisions and a sqrt, per voxel-step. Expect about
2-5x.
WGSL itself cannot do f64; a double-single emulation would cost about 10-20x
per operation.

### Gate 4: reduced arm through the CLI

Arm `w40-reduced`: w40-anchor coefficients, 40x40x72, physicalTimeScale 0.06,
so the unchanged `fixedTerminalSchedule` gives 61 checkpoints from 24 to 6497
steps. Float32, 69 s.

* 61 sample files.
* The replay's `local_tip` resolves 61 of 61; the unchanged JavaScript
  `localTip` (node) resolves 61 of 61; the final rho agrees to 9e-15 relative.
* The replay's `load_campaign` and `operating_state` run (V = 0.150, rho = 16.6,
  transient).
* The full replay CLI stops in `morphology()` with "incomplete or offset
  surface patch". That stage needs a psi = 0.5 crossing in all 1600 columns of
  the 40x40 patch; the reduced arm covers 935-984 of them. This is a property
  of a short, small run, not of the schema.

Restart: a run interrupted at checkpoint 8 and resumed from its dump wrote all
12 checkpoint files byte-identical to an uninterrupted run (float64).

## Notes for the 270x270x612 arm (44.6M voxels, 108,282 steps)

* Memory: the port's persistent state is 8 arrays (phi, T, the ping-pong pair,
  A.xyz, w): 64 B/voxel in f64 (2.66 GiB), 32 B/voxel in f32. Measured CPU peak
  commit is 3.26 GiB in f64. CuPy adds about 25 chunk-sized temporaries
  (1.7 GB in f64 at the default 2^23-voxel chunk), so about 4.5 GB in total.
  The WebGPU fixture uses 61 B/voxel in f32 (2.53 GiB). If memory is tight,
  the 4 flux arrays could be recomputed per chunk with a halo instead.
* Time: not feasible on this CPU (11.5 days); it needs a CUDA GPU (estimates
  above).
* The 270-wide planes give 2-layer z-chunks at the CPU default, and the halo
  copies halve throughput. Tiling in y would fix this (not implemented).
* Clock: cap = floor(1.6e8/44.6M) = 3 steps per batch; the port reproduces the
  JS clock bit for bit, so `time` passes the protocol's clock check.
* Dumps: 0.71 GB per checkpoint (f64 phi+T), 43.5 GB for all 61. Use
  `--dump-every 10` (7 dumps) and `--resume`.
* The initial field is built in z-slabs (23 s at full size); `sample()` takes
  under 0.1 s.
* Subnormals: NumPy and CuPy keep f32 subnormals in the phi tail. In larger
  boxes they appear at the diffusion front, for example 8.6% of a 64^3 box
  after 22 steps. The GPU may flush them to zero (not exercised: none arose in
  the captured fixtures). The effect is below 1.2e-38 absolute, but x86
  subnormal assists can slow f32 NumPy.
* `advance` raises on the quantitative status flags exactly as the driver does
  (none fired in any run).

## Fused GPU path (`--backend fused`)

The array path is memory-bound (207 array operations and 3.8 KB of traffic
per voxel-step in f64). On one L40S that is about 10 h for w40-anchor and
about 80 h for w28 in fp64. The fused path runs two kernels per substep:

1. `flux_kernel`: phi to (A.xyz, w).
2. `phase_kernel`: phase plus transport, phi/T/A to phiN/TN. This is the same
   exact fusion the array path uses, plus an `atomicOr` of the status bits.

The kernels are one C source, `FUSED_SRC` in `quant3d-fp64-port.py`, with
`typedef double/float real`:

* Each statement is one operation of the array code, in the same order.
* The constant table is built from the same `TipPort._constants` values.
* `np.maximum`/`np.minimum` semantics are reproduced for the clamps.
* The CUDA build is a CuPy `RawModule` with NVRTC
  `--fmad=false --prec-div=true --prec-sqrt=true`, so every float64
  operation is an IEEE `.rn` operation with no contraction.
* CuPy appends `-ftz=true` to every NVRTC build, and NVRTC rejects a second
  `--ftz`. The first L40S box (2026-11-26) failed all three box gates with
  "--ftz defined more than once", so the port no longer passes `--ftz=false`.
  FTZ affects single precision only:
  * The float64 PTX is identical with `-ftz=true` and with `--ftz=false`
    (checked with NVRTC 12.9, compute_89, comment header aside).
  * The float32 fused path flushes f32 subnormals, as CuPy's own array path
    already did. The fused-vs-array float32 gate stays bitwise.
  * `nvrtc_ptx()` adds the same flag, so the local PTX census matches the
    box build.
* `--backend fused-cpu` compiles the same source for the CPU with
  `-ffp-contract=off` (`$SOLIDIFY_CC`, for example `gcc`; otherwise
  `python -m ziglang cc`). That is how it is validated here, where there is
  no NVIDIA GPU.
* Checkpoint schema, CLI, `--resume` and sampling are unchanged.
* Status flags are read once per `advance`, as in the driver.

Robustness for unattended runs:

* Sample JSONs, the manifest and the `.npy` dumps are written atomically
  (tmp, fsync, rename). Each checkpoint's sample is written before any
  restart dump of the same state.
* `--flush-minutes M` writes a restart dump at the first checkpoint after
  every M minutes and keeps the newest two.
* `--resume auto` starts the run, continues from the newest complete dump, or
  exits as done, so the same command can be re-issued after a kill. It
  re-registers a sample file the manifest missed.
* The progress line and the manifest carry the rate and an ETA.

### Local gates (`quant3d-fp64-port-selftest.py fused`, 2026-11-26)

| Gate | Result |
|---|---|
| (a) fused (CPU build) vs array port, float64; corner 24x28x36 512 steps, centred 17x9x12 200, degenerate 2x3x5 50, w50 eq32 512 | max\|d phi\| = max\|d T\| = 0, 0 value mismatches (bitwise); target <= 1e-12. PASS |
| (a') same, float32 | bitwise identical |
| (b) fused float32 vs captured WGSL (eq32 4096, corner 4096, corner-long 16384 steps) | worst 5.96e-7 (phi), 2.38e-7 (T), the same numbers as the array port; target 1e-5. PASS |
| CUDA build: NVRTC 12.9 to PTX for compute_80/89/90, both dtypes | compiles; 0 `fma` instructions; per voxel-step 172 arithmetic ops, 7 `div.rn`, 1 `sqrt.rn`, 101 loads |
| ptxas sm_89 | f64: phase 56 registers, flux 42, 0 spills; f32: 48 / 32 |
| SASS census (cubin opcode decode; f32 cubin has 0 f64 ops as control) | f64: 281 static FP64-pipe instructions per voxel-step (phase 172, flux 109; the DFMAs come only from div/sqrt) |
| Kill test (fused-cpu, 61-checkpoint reduced arm, SIGKILL at 9 s, then `--resume auto`) | resumed from 1750; all 61 files byte-identical to an uninterrupted run, and content-identical to the earlier NumPy run |
| `--box-gates` dry run (fake CuPy on NumPy, CUDA backend mapped to the CPU kernels) | 15/15 PASS; a missing capture prints FAIL and exits 1 |

The fused CPU build itself runs at 2.4-2.8e7 voxel-steps/s on one core (64^3),
about 3x NumPy.

### Projected L40S throughput (to be confirmed by the box probe)

fp64 is compute-bound on Ada. The FP64 pipe issues 142 SMs x 2 per clock x
2.52 GHz, about 7.2e11 instructions/s. At 281 FP64 instructions per
voxel-step the ceiling is 2.5e9 voxel-steps/s; at a realistic 65-85% that is
1.7-2.2e9:

| Arm | voxel-steps | fp64 (fused) | fp32 (fused, bandwidth-bound, est. 4-10e9/s) |
|---|---|---|---|
| w40-anchor (270x270x612, 108,282 steps) | 4.83e12 | 0.6-0.8 h | 0.15-0.35 h |
| w28 (386x386x875, 315,690 steps) | 4.12e13 | 5.2-6.7 h | 1.1-2.9 h |

GPU memory: 8 arrays, 64 B/voxel in f64 (w28 7.8 GiB). The kernels add no
temporaries.

### Cloud commands (g6e / L40S, Deep Learning AMI Ubuntu 22.04, CUDA 12.x, Python 3.10)

```bash
# code (branch research/q3d-paper with the fused path) and the WGSL capture bundle
cd /home/ubuntu && git clone -q -b research/q3d-paper /tmp/q3d.bundle solidify && cd solidify
# from the laptop: scp verify-out/fp64-port/capture-states.tar.gz ubuntu@BOX:/tmp/   (3.8 MB,
# sha256 c4bb3ee61e084d40c5dcafd72c98539fa2c8063093ed18c2a70880946ef4a501)
mkdir -p verify-out/fp64-port && tar -xzf /tmp/capture-states.tar.gz -C verify-out/fp64-port
# environment
python3 -m venv /home/ubuntu/venv-fp64 || { sudo apt-get update -qq && sudo apt-get install -y -qq python3.10-venv && python3 -m venv /home/ubuntu/venv-fp64; }
source /home/ubuntu/venv-fp64/bin/activate
pip install --upgrade pip
pip install "numpy==2.2.6" "scipy==1.15.3" "cupy-cuda12x==13.6.0"
export CUDA_PATH=/usr/local/cuda
python -c "import cupy; print(cupy.cuda.runtime.getDeviceProperties(0)['name'], cupy.cuda.runtime.runtimeGetVersion())"
# 1. box gates (about 10 min; non-zero exit = stop)
python -I scripts/research/quant3d-fp64-port.py --box-gates --capture verify-out/fp64-port/capture 2>&1 | tee /home/ubuntu/fp64-box-gates.log
# 2. lambda 4 anchor, fp64; 3. lambda 2.8 w28, fp64. Re-issue the same lines after any kill.
A=scripts/research/quant3d-fp64-port-arms.json
python -I scripts/research/quant3d-fp64-port.py --config $A --arm w40-anchor --out /home/ubuntu/fp64-out/w40-anchor \
    --dtype float64 --backend fused --resume auto --flush-minutes 20 --dump-every 61
python -I scripts/research/quant3d-fp64-port.py --config $A --arm w28 --out /home/ubuntu/fp64-out/w28 \
    --dtype float64 --backend fused --resume auto --flush-minutes 20 --dump-every 61
# 4. replay (CPU)
python -I scripts/research/quant3d-q3c-tip-replay.py --campaign anchor=/home/ubuntu/fp64-out/w40-anchor/samples \
    --campaign w28=/home/ubuntu/fp64-out/w28/samples --out /home/ubuntu/fp64-out/replay-fp64.json
```

Unattended queue, in the launcher's style:

```bash
cat > /home/ubuntu/run_fp64.sh << 'EOF'
#!/bin/bash
set -o pipefail
source /home/ubuntu/venv-fp64/bin/activate; export CUDA_PATH=/usr/local/cuda; cd /home/ubuntu/solidify
P=scripts/research/quant3d-fp64-port.py; A=scripts/research/quant3d-fp64-port-arms.json; O=/home/ubuntu/fp64-out
mkdir -p $O
python -I $P --box-gates --capture verify-out/fp64-port/capture > $O/box-gates.log 2>&1 || { touch $O/GATES-FAILED; }
if [ ! -f $O/GATES-FAILED ]; then
  for arm in w40-anchor w28; do
    for try in 1 2 3; do
      python -I $P --config $A --arm $arm --out $O/$arm --dtype float64 --backend fused --resume auto \
          --flush-minutes 20 --dump-every 61 >> $O/$arm.log 2>&1 && break
    done
  done
  python -I scripts/research/quant3d-q3c-tip-replay.py --campaign anchor=$O/w40-anchor/samples \
      --campaign w28=$O/w28/samples --out $O/replay-fp64.json > $O/replay.log 2>&1
fi
tar -czf /home/ubuntu/fp64-out.tar.gz --exclude='*.npy' -C /home/ubuntu fp64-out
for i in $(seq 1 180); do [ -f /home/ubuntu/PULLED ] && exit 0; sleep 60; done
sudo shutdown -h now
EOF
chmod +x /home/ubuntu/run_fp64.sh && nohup setsid /home/ubuntu/run_fp64.sh </dev/null >/home/ubuntu/run_fp64.log 2>&1 &
```

Notes:

* An fp64 hard cap of about 12 h covers the projected 6-8 h.
* `--dump-every 61` keeps only the terminal state (0.71 GB for the anchor and
  2.1 GB for w28 in f64), besides the two rolling restart dumps.
* For fp32 controls, add `--dtype float32` and use a separate `--out`.
* If CuPy cannot find NVRTC, `pip install "nvidia-cuda-nvrtc-cu12==12.9.86"`
  and point `CUDA_PATH` at the toolkit.

## WGSL details assumed or not matched

1. Division and sqrt: the port uses IEEE; the GPU uses reciprocal-based
   division (shown above) and possibly approximate sqrt. This is not emulated.
2. Residual 1-ulp phase-pass differences on far-field tail cells: cause not
   identified (likely compiler reassociation).
3. Const-expression folding of `47.0/75.0` and `1321.0/9870.0`: assumed
   folded in f64 as AbstractFloat, then rounded to f32 (consistent with the
   matches).
4. f32 subnormal flushing on the GPU: not exercised.
5. Not validated against the GPU: the `latticeKinetics = false` branch (it is
   implemented), the CuPy backend, and `--inputs exact` (a modeling choice
   with no GPU counterpart).
6. Metrology: NumPy `arctanh` differs from V8's `Math.atanh` by up to 1 ulp
   on 21% of random arguments, yet `sample()` matched the GPU JSON bitwise on
   every captured state. `x ** 2` and `x ** 4` use Python's `pow`, where V8
   uses its own; any difference sits at the 1e-16 level and only affects
   patch geometry through ceil/floor.
