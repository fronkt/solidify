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
