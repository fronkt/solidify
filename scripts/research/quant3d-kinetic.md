# Finite-speed coupled planar cross-check

This research fixture compares production 3D WebGPU evolution with an independent CPU traveling-wave profile. It tests a moving [100] plane at a **finite velocity**. It does not assert zero interface kinetics or agreement with a dendrite reference.

The CPU reference retains the physical finite shift in both phase and heat. Its finer traveling-coordinate derivative and outgoing complex thermal tails have independent derivative, interval, and mode-count controls. The far liquid temperature is a solved unknown; latent heat is coupled and the latent jump is not imposed. The method follows the distinction between discrete planar kinetics and equilibrium surface energy in [Karma and Rappel, PRE 57, 4323 (1998), Sec. VI.B.2](https://doi.org/10.1103/PhysRevE.57.4323).

Generate the target with Python, NumPy, and SciPy from the repository root:

```powershell
python scripts/research/quant3d-kinetic-reference.py
python scripts/research/quant3d-kinetic-cpu.py
node scripts/research/quant3d-kinetic-check.mjs verify-out/kinetic-self-test 5199 --self-test
```

The exporter writes the explicit target JSON and includes its own source hash, numerical environment, Newton history, controls, raw Float64 profile hash, values, and spline derivatives. The second command independently evolves that profile on the physical CPU lattice and writes `verify-out/quant3d-kinetic-cpu.json`. It includes Euler time refinement, RK4, domain enlargement, four cell phases, and a Float32 sensitivity arm. The CPU runs do not import application or GPU code.

After a deliberate source freeze and coordinator scheduling, start the app on port 5199 and run:

```powershell
node scripts/research/quant3d-kinetic-check.mjs verify-out/quant3d-kinetic 5199 --run
```

`CHROME_PATH` and JSON-array `CHROME_ARGS` support another installed Chrome platform. The default command without `--run` performs only the CPU profile self-test.

The GPU fixture uses `FLUX3D_WGSL`, `phi3dWgsl(false)`, and `transport3dWgsl(false)` with `rect3dSpecialize` changing integer texture geometry only. Before the long domain, nine state/grain/age SHA pairs must agree with native `Sim3D(32)` at 1, 17, and 64 steps, and the fields must evolve. The study then runs [1536,8,8] at time steps .016/.008 and four initial cell phases, plus [2048,8,8] domain controls. Every arm runs eight cell periods, nominally 160 tau0. Actual time is recorded as exact steps times the Float32 uniform time step, alongside nominal time.

The parameters are lambda=4, epsilon=.0171, tau=1, D=2.5068, and dx=.8, with pure coupled heat, identity orientation, and no noise or external program. The stored fields are psi=(phi+1)/2 and Ttilde=u+1. The solved far liquid Ttilde is slightly negative because this independent planar diagnostic has undercooling slightly above one; it is a dimensionless model input, not a Kelvin temperature.

At every cell period the runner saves direct Float32 profiles with SHA hashes and reports mean phase-volume advance, residuals against the independent moving profile, energy change, and separate modal bulk-temperature fits. Device errors, missing motion, native hash mismatches, incomplete steps, nonfinite fields, and lost transverse symmetry fail the run. Scientific residuals are reported for independent review without an invented pass band. A completed comparison is not a zero-beta claim. Source hashes are checked again at the end.
