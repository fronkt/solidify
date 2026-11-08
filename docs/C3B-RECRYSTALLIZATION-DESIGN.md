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

## 6. Addendum, 2026-11-07: C3b-3 (constant rate) and C3b-4a (boundary sites)

Written before any code, on feature/rx-rate fast-forwarded to c3b021d (PR 7's
head with the S0 review fixes: freeIds, the treatment's pin in nucleate, the
placed count). Pre-registrations: tasks/todo.md, "C3b-3 and C3b-4a -
2026-11-07".

### 6.1 Where the new modes live

`Sim3D.nucleate()` keeps its body: it IS the at-once, random-site path and
every existing caller keeps calling it. The two new modes go through a second
entry, `Sim3D.nucleateEvent(count, opts)`, which draws its orientations and
random sites in exactly the order `nucleate` does (every quaternion for the
range first, then x, y, z per nucleus, all from stream("recrystallization")).
So an event with one batch at sweep 0 and random sites is the at-once event
bit for bit (a gate, RX3-RATE-SCHEDULE), and a steady event differs from the
at-once event of the same seed only in WHEN each nucleus is born. `nucleate`
gains no parameter; it only drops a pending schedule (null assignments) so two
events can never interleave.

### 6.2 Constant rate on the sweep clock (C3b-3)

- Schedule (pure, `birthSchedule(count, window, batches = 16)` in
  recrystallize.ts): B = min(count, max(1, window), batches) batches at sweeps
  t_b = floor(b window / B), b = 0..B-1, carrying
  c_b = round((b+1) count / B) - round(b count / B) nuclei (every c_b >= 1,
  sum = count, cumulative within 0.5 of the constant-rate line count (b+1)/B at
  each batch end). window <= 1 is one batch at sweep 0, i.e. at once. Births in
  [t_b, t_b+1) are lumped at t_b; the kinetics gate uses the actual schedule,
  so the lumping is part of the expectation, not an error in it.
- Clock: a birth "at sweep t" happens after t sweeps of the NEXT `anneal` call
  have been delivered, after that call's sample hook for t (so a sample at t
  reads the field before the births) and before sweep t + 1. Batch 0 at sweep
  0 is stamped inside `nucleateEvent` itself, before the anneal. Births never
  restart or reorder the salts or the recovery ordinate: they sit between
  submits exactly where the sample hook already does.
- The panel's steady window is the whole delivered treatment (`total` sweeps,
  up to 16 batches): a constant nucleation rate during the hold, the textbook
  definition. Recovery lowers the drive as the hold goes on, so late nuclei
  may not grow (H_S = H0/(1 + rec H0); an r = 2 nucleus first grows near
  H = 12 on the RX3-NUCLEUS-LADDER). That is the model's physics, stated on the
  card, not hidden by a shorter window. Fork for Frank: a "drive window"
  (births only while the most deformed grains still exceed the flat-front
  barrier of 8 J_b) would keep more nuclei alive but couples the schedule to
  the recovery law.
- Sites already recrystallized when a nucleus is due: the schedule is a rate
  per unit TOTAL volume, as in JMAK, so every site is drawn uniformly over the
  domain up front and, when its batch is due, the field is read back once and
  a nucleus whose centre voxel already carries an id of this event is a
  PHANTOM: not stamped, its id left unused. Only earlier batches make
  phantoms; within a batch overlaps resolve as in the at-once stamp (first in
  list order wins, a later sphere claims only what is still matrix). A centre
  on a voxel the mask will not treat behaves exactly as in `nucleate` (the
  sphere's treatable part is stamped, possibly nothing).
- Id budget: unchanged in shape. The whole range is allocated off the down
  counter up front through `freeIds` (the at-once rule), so an event cannot run
  dry mid-anneal and cannot meet a growth twin (twins are held back while cold
  work is dialled, and nuclei need cold work). When fewer ids are free the
  schedule is rebuilt for k = min(count, free) over the same window: the same
  shape at a lower rate, reported as placed below requested. Phantom ids are
  spent; X counts raw voxels over [lo, hi], so unused ids do not bias it. A
  wrapped cast or counter refuses as before. An explicit schedule (fixtures)
  that does not fit the free ids refuses instead of being rescaled.
- Anneal: a pending schedule is consumed by the next `anneal` call; births due
  after its last delivered sweep (an abort, or a shorter call) are recorded as
  not born and dropped when it returns. `deposit`, `clearStored`, `reset` and
  `nucleate` drop a pending schedule. With none pending, `anneal` issues the
  same submits and awaits as before (one null test per sweep).

### 6.3 Boundary-only sites (C3b-4a)

- A voxel is a boundary site when it is treatable (HTMASK3's predicate
  without particles: phi >= 0.5, id not 0 and not PORE, not mould) and at
  least one of its 26 neighbours INSIDE the domain (no wrap: the anneal clamps)
  is treatable and carries a different id. Liquid, pores and mould are free
  surfaces, not grain boundaries. The 26-stencil matches the anneal's bond
  count. Pure: `boundarySites(ids, ok, n)` in recrystallize.ts, 13 half-offset
  passes.
- Classified once, in `nucleateEvent`, from the field as it stands after the
  deposit and before any nucleus (`readGrainVolume`, `readPhiVolume` and the
  CPU mould mask): the deformed matrix's own boundaries. Every nucleus of the
  event, steady or not, draws its centre uniformly from that list
  (rxRng.int(list length) per nucleus, in id order, after the orientations).
  Later batches are phantoms when the site is already recrystallized
  (nucleation on the parent boundaries, swallowed sites lost). An empty list
  (a single crystal) refuses with a sentence and moves nothing.
- Particles: the panel holds the dispersion back while nuclei are dialled
  (S0 F3), so the classifier ignoring particle voxels cannot meet a pinned
  panel run. A fixture that pins and asks for boundary sites gets sites that
  may sit in particles (stamped where treatable, as any centre is).

### 6.4 What is expected, and why the gates do not assume a constant velocity

1. Constant rate, random sites. Avrami's extended volume (Avrami 1940,
   doi:10.1063/1.1750631; its abstract, read via OpenAlex, relates the actual
   transformed volume to an extended volume for randomly distributed nuclei,
   reducing the problem to finding the extended volume): with sites uniform in
   space and phantoms included, X(S) = 1 - exp(-X_ext(S)),
   X_ext(S) = sum_b c_b V(t_b, S) / V_domain, where V(t, S) is the volume at
   sweep S of a nucleus born at t growing alone. So ln(-ln(1-X)) against
   ln X_ext has slope 1 and intercept 0 whatever V does. The trap: V(t, S) is
   NOT V1(S - t). Recovery makes the front speed a function of the global
   sweep count S, so a nucleus born late grows slower than a fresh one of the
   same age; the gate therefore MEASURES V(t_b, S) on a lone nucleus born at
   t_b in its own run (same anneal sweep indices, so the same salts and the
   same recovery ordinate), the RX3-JMAK doctrine extended to birth times.
   Textbook: constant rate I and constant speed v give
   X_ext = (pi/3) I v^3 S^4, so n = 4 (derived here from the integral; the 2D
   analogue for continuous nucleation is LA-UR-86-421's comparison in section
   1). Here n is reported on the sweep clock only: the inserted radius r0 = 2,
   the finite window and recovery all pull it below 4 (CPU sizing on the
   gate's geometry: 2.7-3.1). Departures the band absorbs: a phantom's sphere
   can stick out of the grain that swallowed its site by up to r0 (CPU sizing:
   slope 1.01-1.05 at r0 = 2); size-dependent growth is inside the measured
   V(t_b, S); lattice anisotropy is common to every nucleus (the
   extended-volume argument needs one convex shape, not a sphere).
2. Boundary sites, all at once. With every nucleus born together and one
   growth law, the transformed region is exactly the union of the free-growth
   shape translated to every site (equal speeds: the first front to reach a
   point is the nearest site's). For Poisson sites its expectation is the JMAK
   form; boundary sites are correlated on a 2D network, nuclei on one boundary
   impinge on each other first and a covered boundary then thickens like a
   slab, so X follows the distance a front has travelled rather than V1 and
   ln(-ln(1-X)) against ln V1 bends below slope 1. The classic treatment is
   Cahn, Acta Metall. 4 (1956) 449, doi:10.1016/0001-6160(56)90041-4, grain
   faces idealized as random planes: UNVERIFIED (closed; no abstract in
   OpenAlex or Crossref, Unpaywall lists no copy, ScienceDirect refused the
   fetch; secondary summaries say site-saturated boundary nucleation turns
   linear in time late). No band rests on it. The gate computes the union
   directly from the event's actual centres and the measured shape of one
   nucleus grown alone, so the expected slope of ln(-ln(1-X)) against
   ln(-ln(1-U)) is 1 on ANY site set, and the Poisson construction
   1 - exp(-N V1/V) is the negative control that boundary sites must fail
   (slope < 0.85) while random sites on the same polycrystal pass it. CPU
   sizing (union of balls, the gate's geometry: 12 Voronoi grains in 96^3,
   600 sites, interior box): boundary 0.69, random 1.03-1.06 against ln V1;
   sweep-clock n 1.33 against 1.66-1.76. The fixture's matrix carries ONE
   stored energy, so every front obeys one growth law; on the cast's
   heterogeneous fabric neither construction is expected to hold (RX3-PANEL's
   n of 0.61 is that case).
3. Boundary sites at a steady rate: structural gates only (both mechanisms
   are gated separately); kinetics reported, not gated.

### 6.5 UI, share link, feature-off

- One select, "nucleation", after the nuclei dial (the eighth form cell; NOT
  a range input, so the panel still has seven dials and the gates that find
  dials positionally are untouched): `random, at once` (default),
  `random, steady`, `boundaries, at once`, `boundaries, steady`. Volume only,
  reset to the default on every open like every other dial. In a two-column
  form the eighth cell sits beside the seventh, so the panel does not grow; in
  one column it adds one select row.
- Card: the default mode's card is byte-what it was. Other modes add a clause
  to the recrystallized row ("on grain boundaries"; "steady: B batches over N
  sweeps, P sites already recrystallized", plus "U not born" after an abort)
  and swap the Avrami row's reference sentence (steady random sites: constant
  rate with constant-speed growth gives 4). Placed counts every batch.
- Share: an 8th tuple element (the mode, 1-3) is packed only when nuclei > 0
  and the mode is not the default, so every existing link keeps its shape; the
  decoder accepts 3/5/6/7/8 elements (still whole-rejecting any non-finite
  element), snaps the 8th to an integer in 0..3 and applies it in the volume
  only. Pack and apply move to a pure module (src/heatshare.ts) so a
  browser-free gate can round-trip legacy tuples against the old decoder's
  field values.
- Feature-off: the default mode calls `nucleate` as before; `anneal` with
  nothing pending is unchanged; a 3/5/6/7-element link decodes to the same
  dials; the default card and the 7-element tuple are unchanged. Existing
  RX/HT/SE gates run the same code they ran.

### 6.6 C3b-4 remainder (scoping only, not built)

- Particles with nuclei: today the panel holds the dispersion back while
  nuclei are dialled. To lift that: (1) X's denominator must exclude particle
  voxels (they keep their deformed ids and can never recrystallize), i.e. a
  census over treatable voxels rather than all solid; (2) the stamp already
  takes the pin (S0); (3) the boundary classifier would need the particle
  predicate (the HTMASK3 hash replicated on the CPU, or COPY_SRC on the mask
  texture); (4) gate: LA-UR-90-459's result (OSTI 7168388, read in section 1),
  particles stop completion at low H and have no effect at high H,
  pre-registered as a direction on X_end against f at two drives.
- Twins inside RX grains: blocked twice. `twinEvent` takes a parent only below
  `nextId`, and every RX id sits on the down counter above it; and Sigma-3
  twinning is held back while cold work is dialled because a twin born at the
  deposit's fabric value can eat its parent. A build would: (1) let
  `twinEvent` take parents in the current event's [lo, hi] (rxRange tells RX
  ids from twin ids, which share the counter); (2) give each such twin its
  parent's stored energy on the CPU at allocation (0 for an RX parent: the CPU
  already reads the counter, so it knows the id; nothing on the GPU writes H);
  (3) re-enable twinning for RX parents only, keeping it held back for
  deformed ones; (4) budget: twins and nuclei then split one counter, so the
  host's per-grain twin budget must count the event's ids; (5) gates: Sigma-3
  registry of every RX-hosted twin, H(twin) = H(parent) in both mirrors, no
  twin in a deformed parent, budget saturation reported.
