# D3 slice 1 design: forced melt flow in the 2D phase field

Provenance: independent read-only design pass, 2026-11-01, against commit
1a988f6 (line numbers refer to it). Tong et al. 2001 was read from the primary
text; other references are abstract/listing only unless noted, and UNVERIFIED
marks claims not confirmed from a source. Not yet reviewed for implementation.

Note for implementation: the 2D render uniform already grew from 64 to 80 B on
feature/visual for the replay (slots 16-17 used, 18-19 spare); FLOW must take
its render slots after those.

## Recommendation

D2Q9 two-relaxation-time (TRT) lattice Boltzmann, one LBM step per phase-field
substep; solid represented by the Beckermann/Tong diffuse-interface drag
(h = 2.757), treated implicitly; flow fed into the existing face-flux transport
pass. The only quantitative claim: the calibrated pure-melt path against Tong
et al. 2001 Table II. Every other path is labelled qualitative.

## 1. Method

- LBM, not a Chorin projection: projection needs a Poisson solve per step
  (Jacobi hopeless at 1024^2, multigrid a big WebGPU subsystem); D2Q9 is
  local, one dispatch, fits the ping-pong pattern. Phase-field + LBM on GPU:
  Rojas, Takaki & Ohno 2015 (J. Comput. Phys. 298:29-40; DOI UNVERIFIED);
  Sakane et al. 2017 (J. Cryst. Growth 474:154, doi:10.1016/j.jcrysgro.2016.11.103).
- TRT collision: Ginzburg, Verhaeghe & d'Humieres 2008 (Commun. Comput. Phys.
  3:427-478); magic parameter Lambda = 1/4 (attribution UNVERIFIED).
- Forcing: Guo, Zheng & Shi 2002 (PRE 65:046308, doi:10.1103/PhysRevE.65.046308).
  Inlet: Zou-He velocity (Phys. Fluids 9:1591, doi:10.1063/1.869307); outlet
  zero-gradient; side walls free-slip (matches the clamped phase-field edges,
  shaders.ts:118).
- Solid: Tong, Beckermann, Karma & Li 2001 (PRE 63:061601,
  doi:10.1103/PhysRevE.63.061601; pp. 1-10 read): Eq. 4 div[(1-phi)V] = 0;
  Eq. 5 momentum in superficial velocity u = (1-phi)V; Eq. 6 drag
  M = -nu 2h phi^2 (1-phi) V / W0^2, h = 2.757 "by an asymptotic analysis of
  plane flow past the diffuse interface" (attributed to Beckermann et al.
  1999, J. Comput. Phys. 154:468, doi:10.1006/jcph.1999.6323; that text
  UNVERIFIED); Eq. 2 advection (1-phi) V.grad u. As an LBM force:
  F = -2h nu phi^2 u / W^2. Independent CPU check: the steady planar shear ODE
  u'' = 2h phi^2 u / W^2 on the repo's tanh profile (STAMP, shaders.ts:631)
  with h = 2.757 extrapolates the far field to zero at phi = 0.500 (intercept
  0.0000 W). W: calibrated solver = epsBar; Kobayashi = 2 epsBar (its double
  well gives tanh(x/(2 sqrt2 eps)); derived).
- The drag at phi = 1 is ~12 per LBM step at benchmark settings: implicit,
  u = sum c_i f_i / (rho (1 + K dt/2)). Subhedar, Galenko & Varnik
  (arXiv:1909.08465, read): this drag is not Galilean invariant; fine for a
  stationary solid. Write it as u - u_s with u_s = 0 in this slice.
- Forced flow first: inlet on one edge, outlet opposite; Tong used a uniform
  inlet, periodic sides, Re < 1. Buoyancy later.

## 2. Coupling

- Advection as a composable transport fragment: ADV_FACES (split) and
  ADV_NONE (fused), copying AT_FACES/AT_NONE (shaders.ts:363-391). Face
  velocities = averages of cell-centred LBM values; central faces while
  Pe_cell = U dx / D <= 2 (0.08 at the benchmark), upwind above. Each face
  computed as f(low cell, high cell) so both neighbours get identical bits
  and sums telescope (the atFace discipline).
- Calibrated pure: T via TNew -= dt div(uT). Calibrated alloy: the liquid
  concentration c_l = c / (1 - (1-k) psi) as a U-form flux inside the Unew
  bracket (shaders.ts:467), keeping QPF-MASS's conservation structure.
  Kobayashi alloy: u c directly. Frozen temperature: never advect T.
- Explicit boundary faces (a clamped central face would leak): walls 0;
  inlet u_in tFar and u_in c0 (already in P2); outlet upwind interior.
  Open (review 2026-11-07): the inlet brings tFar even while coolRate cools
  the domain, so with cooling on the stream is a heat source (a sink under
  reheat). Whether the reservoir should follow the furnace is a modeling
  choice not made yet; the science page states the limit.
- Clock: one LBM step per substep at dt_LBM = dt, dispatched before FLUX in
  submit(); macroscopic velocity to model units as u dx/dt. Tong used a flow
  step ~10x the phase-field step; if FLOW-TAU-INDEP fails, the pre-registered
  fallback is M LBM substeps per phase-field substep.
- Stability (lattice nu = d Pr, d = 0.15 calibrated (quant.ts:59) or 0.133
  Kobayashi), benchmark lambda 2.4, Pr 23.1, U d0/D 0.035:
  TRT tau = 0.5 + 3 nu_lat >= 0.51 (10.9); Mach <= 0.1 (0.020);
  Courant^2 <= 2d (inside); Pe_cell <= 2 (0.08). Limits become slider ranges
  (dynRange), not silent clamps. The lattice setting (nu, drag width, inlet
  speed) is re-derived from the dials on every substep (flow.ts flowSetting,
  sim.ts submit) and the envelope re-checked every frame: a solver switch or
  a dt / dx / epsBar / lambda change mid-flow re-configures the flow, and a
  change that breaks the envelope switches it off with the reason (review
  2026-11-07: latched at start, the switch kept a 3.1x or 0.32x drag). With
  the Kobayashi alloy's solute advected, its own cell Peclet number
  u / (D_s dt / dx^2) is held to the same limit (1.88 at the rail's corner,
  u 0.05 and solute D 0.2), and the solute's [0, 2] clamp is re-applied after
  the advective flux, which used to run after it.
- Which path is honest: calibrated pure melt with solved T is the only
  quantitative path (Tong's own equations; with the repo's Al constants,
  U d0/D = 0.035 is ~1.6 km/s, so a dimensionless benchmark, not a casting
  prediction). Calibrated alloy: same intensity ~3.4 cm/s for Al-4Cu
  (realistic) but the Schmidt number cannot be matched: Tong's 2D
  Oseen-Ivantsov relation (Eqs. 11-12, transcription reproduces the Ivantsov
  limit to 4 d.p. and Fig. 4's end values) gives growth Peclet 0.391, 0.299,
  0.279, 0.264 at Pr 1, 23.1, 100, 1000 (Delta 0.55, flow Peclet 0.5), so 2D
  is not Pr-independent at low Re; the repo has no viscosity data, so the
  alloy path is qualitative ("Schmidt: real not stated"). Kobayashi:
  qualitative, direction only.
- Refusals via one pure flowRefusal(): scenario != 0; frozen-T pure melt;
  2048^2 (each population buffer 151 MB > the default 128 MiB storage limit;
  main.ts:52 requests no limits); 3D; heat treatment/optimizer/challenge;
  any stability limit exceeded.
- Memory/cost: 2D state 68 B/cell (~71 MB at 1024^2); velocity texture
  rg32float always (8 B/cell); LBM populations 2 x 9 x f32 = 72 B/cell lazily
  (~19 MB at 512^2, ~76 MB at 1024^2). Split step ~0.8 ms/substep at 1024^2;
  LBM adds ~100 B/cell traffic, est. +35-50% (UNMEASURED; FLOW-COST info).

## 3. Touchpoints (at 1a988f6)

- shaders.ts: 2 of 5 spare P2 slots (:37-55, pads :102-106) for flowScale
  (f32: dx/dt x coupling 1/0/-1) and flowEdge (u32); BYTES stays 192
  (PARAM-WARN holds). ADV_FACES + a second TRANSPORT_CORE argument (:393),
  spliced after T (:400), inside Unew (:467) and Warren-Boettinger (:479).
  Binding 8 velocity texture in TRANSPORT_WGSL (:568-587). New LBM_WGSL with
  its own uniform (H2U precedent, :745); PARTICLE_WGSL; render case 10u FLOW
  before the CAST default (:1361). UPDATE_WGSL (:534) byte-identical.
- sim.ts: PhysParams flowOn/flowU/flowEdge/flowPr (:10-93); velTex beside
  phiAuxTex (:256); lazy lbmBuf[2], lbmBG[fdir][sdir]; binding 8 in
  transportBG (:327-339); splitNow (:157) true when flow is live; P2 slots in
  writeParams (:505-541); LBM dispatch before FLUX (:772); re-equilibrate in
  reset (:396) and on dt/dx change; scale stepCap (:549); flowSpinUp(n),
  readVelRows.
- render.ts: bind velocity in rebind (:46-58); slot table instead of literal
  sizes; particle pipeline (~8k particles, RK2, GPU-hash respawn, additive
  streaks).
- src/flow.ts (new, pure): lattice mapping, stability classifier,
  flowRefusal, DRAG_H derived from the planar ODE, Oseen-Ivantsov reference.
- units.ts groups (:274): Prandtl/Schmidt (real: "no viscosity data"),
  Reynolds, flow Peclet (calibrated only), Mach as a validity row.
- ui.ts: FLOW section, 2D only, after SCENARIO (:725): on/off, speed
  (U d0/D when calibrated), inlet W/E/N/S, Pr/Sc, tracers, refusal text. FLOW
  tab in buildViews (:306-331), not LENS_NAMES (landing.ts:60 LENS_SPEC and
  the rail at :257 untouched).
- main.ts: flow params in KOB_OWNED (:429); share view clamp (:2548) allows
  10; readout (:2405-2414); guards in startOptimizer/startChallenge (:901,
  :911); a flow block in the run snapshot (:1772).
- share.ts: new p fields ride the link (:66-76); validate in the boot
  applier; old links = flow off. run-export.ts: flow on the micrograph
  footer's solver line (:163) and a flow field in RunSnapshot (:70).

## 4. Gates

Browser-free (CI): FLOW-H-PLANAR (no-slip plane at phi = 0.5 within 1e-3 W
for DRAG_H; h = 2 gives -0.164 W and must FAIL); OSEEN-REF (Ivantsov limit to
1e-4; Fig. 4 end values 0.257 at flow Peclet 0 and 0.347 at 1, +-0.01);
FLOW-PARAMS (tau/Mach/Pe_cell mapping; refusal predicate driven on what it
refuses); SHARE-FLOW (round trip; hostile link clamped); WGSL-PINS (SHA-256
of FLUX, UPDATE, PHI, STAMP, STATS unchanged from base).

GPU: FLOW-OFF-IDENTITY (capture scripts/fixtures/kob2d-baseline.json at the
base: 2D state/grain SHA-256s for Kobayashi fused and split, calibrated pure,
calibrated alloy, Bridgman, weld, stamp+quench, twinProb = 0; flow off must
match exactly; PASSSPLIT3 precedent); FLOW-ZERO-IDENTITY (flow on at U = 0
bit-identical to split-shape flow off, with a witness that LBM dispatched);
FLOW-TG-DECAY (sin/cos mode in a free-slip box: measured nu within 1%);
FLOW-DRAG-PROFILE (planar shear at tau 10.9, W/dx 1.25: GPU vs ODE within
0.02 shear W; in phi > 0.99 |u| <= 2e-3 shear W, continuum 4e-4; note the
continuum leaves 0.35 shear W at phi = 0.5, so "zero velocity at phi > 0.5"
would be the wrong bound); FLOW-TAU-INDEP (M = 1 vs 8 within 1%, the kill
criterion for one LBM step per substep); FLOW-ADVDIFF-GAUSS (no solid:
centroid speed within 0.5% of U, variance growth 2Dt within 2%);
FLOW-FREESTREAM (uniform T and c past a frozen disc stay uniform; bound ~
Mach^2, measured then pinned); FLOW-MASS-BOX (closed box with forced
cellular flow: frozen phi conserves c to round-off; growing calibrated-alloy
dendrite drift within QPF-MASS's 3e-3, tips moved); FLOW-MIRROR (zero noise,
theta0 = 0: inlet W vs E mirror within 1e-4); FLOW-DIRECTION (Kobayashi:
upstream/no-flow > 1.05, downstream < 0.95, labels swap when the inlet
reverses); FLOW-TIP-TONG (headline: Delta 0.55, eps4 0.05, Pr 23.1,
U d0/D 0.035, lambda in {2.0, 2.4, 3.2}, 1024^2, domains >= 1853 d0 (above
Tong's converged 1658 d0), tau V/W <= 0.18, reusing verify-quant staging
(:59-83, :237-400); Tong's same-lambda ratios 1.37-1.43 (Tables I-II);
pre-registered pass: upstream/no-flow in [1.26, 1.54], spread across lambda
< 5%, absolute V d0/D within 0.0245 +- 15% (QPF-TIP-KR's band); info only:
downstream (Tong ~-45% at eps 0.03) and parabolic-fit Peclet vs Oseen).
Falsification: coupling 0 (velocity present, ratio exactly 1, FLOW-TIP-TONG
must FAIL); coupling -1 (ratio < 1, must FAIL); h = 0 (FLOW-DRAG-PROFILE must
FAIL). FLOW-VIZ-INERT (state hashes identical with particles on/off; particle
displacement matches local speed). FLOW-COST (info).

## 5. Risks and phases

Gates at risk: PASSSPLIT tolerance (transport text changes); landing-acts and
hero if LENS_NAMES grows (avoided); verify-rail (section height); CALIB-LOCK
and the derived row count; SHARE ROUND-TRIP and run-export schema; TESTING.md
inventory counts; RParams size vs binding; GPU timeouts unless stepCap
shrinks; fixture determinism needs twinProb = 0. TRT at tau ~ 11 may fail
FLOW-TAU-INDEP (fallback: M substeps at measured cost). 2D results depend on
domain size (log-type), so the gate states its domain in d0. The Kobayashi
interface is 1-2 cells, so its drag is barely resolved (acceptable:
qualitative).

Phases: D3.0 baseline fixtures, slot tables, velocity plumbing at scale 0,
flow.ts, browser-free gates (zero physics change); D3.1 LBM + fluid-only
gates; D3.2 coupling + Tong gate + falsification arms; D3.3 FLOW lens,
particles, UI, share, export, science-page text.

Later: per-material viscosity (real Pr/Sc rows); high-Sc subcycling;
buoyancy (needs cited beta_T and beta_c; tiny at um scale); moving solid with
Galilean-correct drag; 3D (D3Q19 at two copies = 152 B/voxel, ~1.08 GB at
192^3: needs AA-pattern single-buffer streaming, smaller grids, its own
uniform); freckles are not phase-field scale: casting-scale mushy-zone model,
Ra_crit ~ 0.25 per the abstract of Beckermann, Gu & Boettinger 2000 (Metall.
Mater. Trans. A 31:2545, doi:10.1007/s11661-000-0199-7).

Honest scope for slice 1: one benchmarked number (Tong's upstream ratio for a
dimensionless pure melt); everything else is a conservation/analytic check or
labelled qualitative.

## D3.5 addendum: velocity inlet (2026-11-07)

Section 1 names a Zou-He velocity inlet; the shader shipped an equilibrium
inlet instead. This addendum records the defect, the replacement and how it
composes with the rest of the step. Gates: tasks/todo.md, "D3.5 velocity
inlet - 2026-11-07".

Defect (lbm.ts at 3b3fbdd, pull(), lines 74-75): a population that would
stream in from x < 0 is `feq(i, 1.0, vec2f(L.uIn, 0.0))`. Only the three
populations with c_x = +1 (1, 5, 8) come from there; the other six of the
inlet node come from the interior. Summing the x momentum with c_s^2 = 1/3
gives, to first order in U and in rho_i - 1 (rho_i the interior density next
to the inlet),

  u_inlet ~ U - (rho_i - 1) / 3   (lattice units).

So the inlet fixes the density of what enters as well as its velocity, and
any overpressure inside the channel cuts the delivered speed. D3.4 measured
inlet rho 1.0061 at n 848: (0.0061 / 3) / 0.011404 = 0.178, i.e. 0.82 U
predicted against 0.820 U measured. Two routes to an overpressure:

- Blockage: a crystal needs a pressure drop to push the flow past it (Stokes
  regime, Re < 1, so the drop scales with the flux and with nu, which is 3.465
  in lattice units at Pr 23.1).
- History: the outlet is zero-gradient, so nothing fixes the density level
  (any uniform rho with uniform u is a steady state of the walls and the
  outlet). A start-up or speed-change compression wave raises the level and it
  stays. CPU reference (scripts/fixtures/lbm-ref.mjs, the shipped inlet) on an
  EMPTY 64^2 free-slip channel at nu 3.465: started at U/2 it settles at
  0.873 U (level 1.0043), from rest at 0.747 U. The rail's speed dial
  re-initialises the populations at the new speed (main.ts setFlowU ->
  sim.setFlow(true)), so the dial itself starts from a steady stream; but the
  level is set by every transient after that (the uniform start inside an
  existing crystal, the crystal's growth), so the delivered speed depended on
  the run's history as well as on the blockage.

The same mismatch reached transport: ADV_FACES brings u_in X_far in through
the face at x = -1/2 using the dialled speed, while cell 0's lattice velocity
was ~0.82 U, so cell 0 saw a spurious divergence of ~0.18 U per substep.

Replacement: the Zou & He (1997) velocity inlet on the west nodes. After the
pull, with the six known populations of the node,

  rho (1 - U) = f0 + f2 + f4 + 2 (f3 + f6 + f7)
  f1 = f3 + (2/3) rho U
  f5 = f7 - (f2 - f4)/2 + (1/6) rho U
  f8 = f6 + (f2 - f4)/2 + (1/6) rho U

which gives sum f = rho and sum c f = (rho U, 0) exactly (the normal pair by
non-equilibrium bounce-back, f1 - f1eq = f3 - f3eq; the transverse correction
on the diagonals zeroes the y momentum). It is local (the node's own pulled
populations), so it fits the pull kernel without another pass. Alternatives
not taken: equilibrium at the local density (feq(rho_local, U)) discards the
non-equilibrium part and imposes u only to first order; Ladd's velocity
bounce-back puts the condition at the half-way face to second order, where
the gates and the velocity texture read the node.

Composition. Zou-He replaces the three unknown populations BEFORE the moments;
the node then collides like every other node (TRT, Guo source, implicit drag).
At a liquid, force-free inlet node (K = 0 and no body force: every channel the
app runs) F = 0 and the stored velocity (m + F/2) / (rho (1 + K/2)) is (U, 0)
exactly. If a crystal grows into column 0 (K > 0), the populations still carry
rho U and the drag slows the stored velocity to U / (1 + K/2), as the old inlet
did; a uniform body force in channel mode (no app path sets one) would shift it
by F / (2 rho). Under TRT the reconstruction sets the antisymmetric
non-equilibrium part of the normal pair to zero and keeps the symmetric parts
of the known populations, so no new relaxation parameter enters at the inlet.

Corners. At (0, 0) and (0, n - 1) the pull fills the known populations first,
the free-slip mirror supplying those that would come from beyond the wall
(f2, f6 at y = 0; f4, f7 at y = n - 1). The three with c_x = +1 are then
inlet unknowns whatever the mirror did (f5 at (0, 0) crosses both edges; the
inlet owns it). Both conditions require u_y = 0 at the corner, so they agree;
the field stays mirror-symmetric about y = (n - 1)/2.

Outlet: kept zero-gradient. A velocity inlet fixes the flux; in a steady state
continuity carries the same mass flux through every column, and the outlet
only has to let it out. The density level stays a neutral mode: it shifts the
mass flux rho u but not the velocity u that advection reads, so the D3.5 gates
read the column-mean velocity and keep the mass flux's uniformity as a
conservation witness. A pressure outlet would pin the level and nothing the
phase field reads needs it; it would also be a second boundary change in one
slice.

Expected behaviour. The inlet column carries (U, 0) to f32 precision. With a
blockage, the pressure drop that pushes U past it makes rho fall along the
channel, so the column-mean velocity rises from U at the inlet to U (1 + s)
at the outlet, s the density span. The shipped inlet's CPU sizing at the gate
geometry (n 128, disk of radius 9.6 cells, blockage 0.15) gives 0.832 U with a
span of 0.76 %; the drop scales with the flux, so the velocity inlet should
give s ~ 0.9 %. The span is a weak-compressibility property of the lattice at
nu 3.465 (it grows as nu U / n at fixed blockage: ~6 % at n 64 with blockage
0.4), not of the inlet; the old inlet hid it inside the deficit. The shipped
inlet stays selectable only as a test-harness option (FlowConfig.inlet =
"equilibrium"), for the must-miss arms; the app never sets it.
