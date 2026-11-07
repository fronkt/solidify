# C3b design: primary static recrystallization in the 3D Potts anneal

Provenance: independent read-only design pass, 2026-11-01, against commit
1a988f6 (line numbers refer to it). Literature marked UNVERIFIED was not read
in full text; everything else was read from the primary source. Not yet
reviewed for implementation; see tasks/todo.md "Visual and science expansion".

## 1. Model

Site-saturated, uniformly random sites, inserted spherical nuclei with H = 0,
a new id and a random orientation. All new behaviour flows through the
existing SIBM line (shaders3d.ts:1153); the anneal kernel is unchanged.

- Classic protocol: Anderson, Grest & Srolovitz, LA-UR-86-421 (OSTI 6050460,
  read): "a fixed number of nuclei were randomly placed in the microstructure
  and no additional new nuclei were created". 2D Avrami slopes 2.3 +- 0.2
  (site-saturated) and 3.0 +- 0.2 (constant rate) against theory 2 and 3;
  final mean grain area ~ 1/N (site saturation), ~ rate^(-2/3) (constant
  rate); no incubation. H/J = 0.1-5 (metals 0.01-0.1). Journal versions:
  Srolovitz, Grest & Anderson, Acta Metall. 34 (1986) 1833,
  doi:10.1016/0001-6160(86)90128-8; Srolovitz, Grest, Anderson & Rollett,
  Acta Metall. 36 (1988) 2115, doi:10.1016/0001-6160(88)90313-6 (journal-
  specific numbers UNVERIFIED).
- Site-saturated Poisson nuclei with one growth law give
  X = 1 - exp(-N_v V1(S)) exactly for any time-varying velocity (Avrami 1939,
  doi:10.1063/1.1750380; 1940, doi:10.1063/1.1750631). Recovery makes the
  front decelerate, so the natural-clock form is the sharp gate. Constant
  velocity: n = 3; constant nucleation rate: n = 4.
- Random sites rather than boundary-only: Rollett, Srolovitz, Doherty,
  Anderson & Grest, LA-UR-90-459 (OSTI 7168388, read): "If H/J>2, an isolated
  nucleus is super-critical and can grow. If H/J<2, the nucleus must be
  adjacent to an existing boundary"; 2D KJMA exponent 2. Journal: Acta Metall.
  Mater. 40 (1992) 3475, doi:10.1016/0956-7151(92)90062-J. Triangular-lattice
  critical nucleus (LA-UR-86-421): one site for H/J > 4, three for 4 > H/J > 2,
  effectively infinite below 2. The same bond count on the 26-neighbour
  stencil gives H_FLAT_3D = 8; a radius-2 digital sphere (33 voxels): tip
  voxels revert below H = 8, matrix voxels join at H >= 12 (T = 0, hand count;
  a gate re-derives it). The cold-work fabric spans 0-20 J_b, so the dial
  already crosses from "isolated nuclei grow" to "only boundary nuclei
  survive".
- Later-slice expectations (UNVERIFIED from text): Rollett, Srolovitz, Doherty
  & Anderson, Acta Metall. 37 (1989) 627, doi:10.1016/0001-6160(89)90247-2
  (non-uniform stored energy lowers the apparent n); Cahn, Acta Metall. 4
  (1956) 449, doi:10.1016/0001-6160(56)90041-4 (late-time n -> 1 when
  boundary sites saturate).
- Nucleus: sphere of radius NUCLEUS_R_3D (default 2), pinned only after the
  G4 ladder measures it; inserted whole (the twin-plate doctrine,
  shaders3d.ts:1193-1212).

## 2. Implementation touchpoints

- Id space: MAX_GRAINS3 = 4096 (shaders3d.ts:21), PORE_ID = 4095 (:25); the
  H buffer is 4096 f32 (sim3d.ts:297-299, 483). 4094 usable ids, shared by
  cast seeds (nextId up, sim3d.ts:1394), GPU twins (twinCtrBuf down from 4094,
  :1239, :1909-1924) and nuclei (same down counter). The cast3 fixture pours
  2600 seeds (verify-heattreat-gpu.mjs:770), leaving ~1490.
- LATENT BUG: addSeed3D silently recycles ids once it reaches 4094
  (sim3d.ts:1395). Add an idsWrapped flag (set there, cleared in reset());
  C3b must refuse when set. Twins share the exposure today.
- New Sim3D.nucleate(count, r) -> {lo, hi, placed} | {why}, modelled on
  twinEvent's allocation (:1978-1986): read the counter; refuse if wrapped;
  k = min(count, ctr - nextId - 2); write back ctr - k; ids [ctr-k+1, ctr];
  assert every allocated id has zero voxels; hCPU[id] = 0 then one
  writeBuffer (the setStored primitive, :1291-1303, documented as "C3b's
  nucleus-birth primitive"); positions and quaternions from
  stream("recrystallization") (reserved, shaders.ts:849-851, exercised by
  RNG-NAME-DERIVATION, verify-rng.mjs:71-84); refactor randomQuat (:1374) to
  take an Rng so the sim3d stream's draws stay identical; rxRng.reset() in
  reset(); store rxRange, cleared in deposit() (:1273), clearStored() (:1313)
  and reset() (:1202).
- Order is load-bearing: deposit writes every id in [1, PORE) (:1275-1286),
  so nucleation runs AFTER it (heatpanel.ts right after :1020); nucleate()
  refuses unless hOn.
- New RXSTAMP3_WGSL copying TWINSTAMP3 (:1213-1236): in-place read_write
  r32uint stamp on grainTex[dir], nuclei in batches of 128. Eligibility from
  htMaskTex (:927-972) via ensureHt(); claim only where mask = 1 and the id is
  outside [lo, hi]; first nucleus wins (deterministic). Never binds hs
  ("NOTHING ON THE GPU EVER WRITES H", sim3d.ts:287).
- Recovery unchanged: H_S = H0/(1 + rec*H0) (shaders3d.ts:1081-1084). Stall
  time S* = (1/H_c - 1/H0)/HT_RECOVER_3D (heattreat.ts:589): about 117 sweeps
  from H0 = 20 and 42 from H0 = 8 at H_c = 6, so recrystallization stays
  incomplete mid-dial. Real physics; the card says so.
- Sampling X(S) without perturbing the run: chunking anneal() restarts the
  salt at 1 every call (sim3d.ts:1802), correlating draws (annealTwins does
  this today, main.ts:1677-1693: flag, don't fix here). Add an optional
  sample?: {at(s), read(s)} to anneal (:1779), awaited after a submit, so
  salts and recAcc are untouched. readStats (:2315) gains rxVox (sum of raw
  counts over rxRange) and grainVox (sum over 1..4094), using RAW counts: the
  minVox = 64 filter (:2341) hides an unhatched 33-voxel nucleus.
- Twins and the law endpoint: nuclei only offered when work > 0, so the
  endpoint is already withdrawn (heatpanel.ts:762, :1114) and workHoldsTwins
  holds Sigma-3 back (:992-999). Unchanged.
- Dispersion: hold back while nuclei are dialled in slice 1 (particles would
  sit in X's denominator). Implemented in the panel's plan (pin undefined,
  pinHeld set, a "held back" line on the note and card) after the 2026-11-07
  review found the plan kept it; Sim3D.nucleate also takes the treatment's
  pin so a pinned caller cannot stamp nuclei into particle voxels. The particle slice should expect LA-UR-90-459's
  result: particles stop completion at low H, no effect at high H.

## 3. UI (heatpanel, 3D only)

- Seventh dial "nuclei" 0-1000 step 25, default 0, after cold work
  (heatpanel.ts:659-665); inert at work = 0 ("nuclei need cold work to grow").
- Share tuple: 7th element packed only when nuclei > 0 (setup() :365-377);
  restore type (:320) and applier (:595-618) accept 3/5/6/7 elements; snapped
  to the dial step; dropped in 2D.
- Note: "200 nuclei - random sites - r 2 cells - 0 J_b - isolated nuclei need
  >~ 8 J_b (flat-front barrier) to grow".
- New card row LAST after the cold-work row (:1178-1197) so nuclei-free cards
  stay byte-identical: "recrystallized X 0.83 after 410 MC sweeps - 200
  placed (ids 3895-4094) - 61 grew", then "Avrami n 2.4 (X 0.05-0.95, 9 pts,
  r^2 0.99, sweep clock)" or a refusal sentence.
- Figures in src/plot/process.ts beside heatProcessFigure (:111): X vs S
  (count "Monte Carlo sweeps" / fraction) and Avrami ln(-ln(1-X)) vs ln S
  (dimless), fit dashed plus an n = 3 reference slope through the centroid;
  exportable columns; added to exportFigures.
- New pure src/recrystallize.ts: avramiFit(), log-spaced sample schedule,
  bond-count threshold enumerator.
- Units: J_b only; n is measured on the sweep clock and must never be
  labelled a real-time exponent (sweeps are not linear in furnace seconds).
- Docs in the same commit: learn/panels.ts:282-288, tour.ts:314,
  README.md:477-480, science/index.html:936 ("not modeled" strings).

## 4. Gates

Browser-free (CI):
- RX-AVRAMI-FIT: synthetic JMAK n = 1-4 recovered to 1e-9; S rescaling
  invariant; out-of-window points excluded and counted; < 4 points or X = 1
  refuse; falsification with an initial offset X0 shows the lower bound
  max(0.05, 3 X0) is needed.
- RX-LATTICE-THRESHOLDS: one JS counter reproduces triangular 4 and 2 and
  H_FLAT_3D = 8; derives the T = 0 grow/revert band for the shipped sphere;
  requires the dial top (20) above the grow threshold.
- RX-JMAK-CPU: seeded Poisson-sphere model on 64^3 with decaying v(S): slope
  of ln(-ln(1-X)) vs ln V1 = 1 +- 0.05; constant v gives ~3 vs ln S (band
  measured before pinning).
- RX-STRUCTURE (SE-STRUCTURE style): RXSTAMP3 has no hs binding; its write is
  guarded by the mask and range checks; both acceptance lines byte-unchanged;
  H2U.BYTES still 32; sim3d.ts uses stream("recrystallization"), no
  Math.random.
- RX-FIGURES (verify-process-plots.mjs): no seconds, deg C or J/m^3; the fit
  line's slope re-derived from the figure's own columns equals the n in the
  legend and on the card.

GPU (append to verify-heattreat-gpu.mjs, reusing cast3 and __se fixtures):
- G1 RX3-OFF-IDENTITY: (a) deposit(6) + 60 sweeps; (b) same + nucleate(0) +
  sampling every sweep; (c) nucleate(200). (a) and (b) bit-identical in grain
  volume, hBuf, twin counter, quats; (c) differs; flips > 0 liveness.
- G2 RX3-SAMPLING-INERT: sampling never vs every sweep bit-identical; X from
  readStats.rxVox equals X from a readGrainVolume census.
- G3 RX3-STAMP-COHERENCE: allocator moves by exactly k; allocated ids had
  zero voxels; >= 95% of nuclei landed, each no larger than its digital
  sphere; nothing changed outside the spheres; no liquid/pore/mould voxel
  written; phi and dir unchanged; new ids H = 0; readStored equals hCPU in all
  4096 entries; quaternion mirror matches GPU; same seed same stamp, different
  seed different FNV fingerprint.
- G4 RX3-NUCLEUS-LADDER: one nucleus in a single-crystal matrix, r in
  {1,2,3}, H in {0,4,6,8,12,20}, 40 sweeps; at H = 0 every radius shrinks;
  growth monotone in H; crossover inside the JS T = 0 band widened by the
  kT = 0.6 tail (band set after measuring); pins NUCLEUS_R_3D.
- G5 RX3-JMAK (pre-registered): single-crystal matrix, H0 = 20, 150 nuclei,
  3 seeds; slope of ln(-ln(1-X)) vs ln V1(S) (same-run isolated nucleus)
  within 1 +- 0.15 on every seed; X_end >= 0.95; n vs S reported only.
- G6 RX3-UNDRIVEN: H = 0 everywhere: X_end <= X0; H = 6 everywhere incl.
  nuclei bit-identical to the H = 0 arm; nuclei = 0 gives rxRange null;
  one-off build check that nucleating before deposit fails G3's H = 0 clause
  (confirm the swap landed).
- G7 RX3-CAST-SELECTION (pre-registered, three pours, deposit(10), 200
  nuclei): X in top-quartile-H grains minus bottom-quartile > 0 and >= 3x the
  uniform-H control; surviving nuclei touched >= 2 matrix ids at birth more
  often than all placed nuclei (direction only).
- G8 RX3-PANEL (copper): dial count 7 (edit HT3-SE-PANEL dialCount === 6 at
  verify-heattreat-gpu.mjs:2145 in the same commit, and say so); card rows
  present; card n = avramiFit of exported columns; "MC sweeps" wording, no
  J/m^3, twins held back; share tuple 7 long with nuclei, 6 without (:2167);
  reverting nuclei to 0 checked on the sim (rxRange null).
- G9 RX3-ID-BUDGET: counter preset near nextId -> fewer placed plus a
  saturation sentence; a wrapped cast refused.

Unchanged: all existing HT/SE/RNG gates and HT3-CAST-REPRO hashes (only the
6 -> 7 dial count edit).

## 5. Risks and slices

Risks: id budget and silent wrap, no id reclamation over repeated treatments
(fix = re-pour); deposit/nucleate order; salt correlation if anyone chunks
anneal; recovery stalling X (fit refused; explain, don't tune); n read as a
real-time exponent; the minVox filter; the 4 Hz census poll racing readStats
(retries); RX grains can never be twin parents (twinEvent skips ids >=
nextId, sim3d.ts:1975); a later deposit re-deforms earlier RX grains
(consistent with the dial; document).

Slices:
- C3b-0 (no UI): nucleate() + RXSTAMP3, rxRange/wrap flag/stream plumbing,
  readStats rxVox, anneal sampling hook, src/recrystallize.ts; gates
  RX-AVRAMI-FIT, RX-LATTICE-THRESHOLDS, RX-STRUCTURE, G1, G2, G3, G4, G6.
- C3b-1: G5, G7. C3b-2: panel, figures, share link, docs.
- C3b-3: constant-rate nucleation (n = 4 expected). C3b-4: boundary-only
  sites, particles, twins inside RX grains.
