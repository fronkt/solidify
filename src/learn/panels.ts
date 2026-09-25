/**
 * Learn mode for everything outside the rail (v8 U1b): the four mode panels
 * (lab mode and its run report, heat treat, optimizer, challenge), the
 * analysis panels, the SECTION PLANE popup and the status lines.
 *
 * Same rules as `learn/rail.ts` (docs/COPY-STYLE.md): 1 to 2 sentences, plain
 * words, for a student reading once; what the thing is and why it matters,
 * the physics last; no em dashes; controls named exactly as printed; American
 * spelling. A hint is one line under its control, under about 45 characters.
 *
 * Entries are keyed `panel:<name>`. Caveats that a model module computes keep
 * their learn half beside the line in that module (heattreat.ts `canTreat`,
 * thermal.ts notes, porosity.ts), the U1a doctrine; the pairs here are the
 * ones the panels write themselves.
 */
import { registerLearn, type Caveat, type LearnEntry, type LearnLayer } from "./index";

export const PANEL_LEARN: readonly LearnEntry[] = [
  {
    id: "panel:lab mode",
    text: "Lab mode runs a planned experiment: you fix the charge, the mold and the cooling program first, "
      + "then pour. The run report reads the cooling curve and the grains the way a foundry reads a test casting.",
    hints: {
      "atmosphere": "gas over the melt; air adds oxide films",
      "inoculant sites": "grain refiner particles added to the charge",
      "hold before pour": "time above the liquidus; the refiner fades",
      "pour superheat": "how far above the liquidus it is poured",
      "mold temperature": "mold wall temperature at the pour",
      "cooling program": "how the furnace set-point falls",
      "spec σ_y (as-cast)": "yield strength the casting must reach",
      "mold walls": "cast inside a mold shell (3D only)",
      "mold shape": "step gives four section thicknesses",
    },
  },
  {
    id: "panel:run report",
    text: "What the experiment measured: landmarks read off the cooling curve, the grain count and its "
      + "strength, and what the refiner and the dissolved hydrogen did. \"not resolved\" means the data "
      + "could not support a number, so none is printed.",
  },
  {
    id: "panel:heat treat",
    // the MC is not a check on the law: its sweep count is priced FROM the law
    // (heatpanel plan(), heattreat.ts sweepsFor), so it reaches the law's
    // endpoint by construction and tests only the K_MC calibration. And the
    // coefficients are literature values, some of them round placeholders
    // (ice, SCN), so they are not called "measured" anywhere in learn mode
    text: "Heat treat holds the frozen casting in a furnace, timed in real hours. The material's grain-growth law "
      + "predicts the final grain size, and a Monte Carlo grain model then grows the grains by that much (its step "
      + "count is set from the law), so you can watch the path and measure the result.",
    hints: {
      "temperature": "hold temperature (T_m: melting point)",
      "hold time": "time at temperature, between the ramps",
      "spec σ_y": "yield strength the part must keep",
      "dispersion": "particle volume that pins boundaries",
      "particle radius": "particle size, in grid cells",
      "cold work": "stored deformation energy (bond energies)",
    },
  },
  {
    id: "panel:optimizer",
    text: "The optimizer (CMA-ES) searches for a cooling schedule and refiner charge that hit your target "
      + "grain size. Each tile is one full casting; |ΔG|, the distance from the target, shrinks as it learns.",
  },
  {
    id: "panel:challenge",
    text: "Cast one specimen yourself, steering cooling rate and inoculant n_max while it freezes; then the "
      + "optimizer gets ten castings at the same target. The grain size closer to the target (smaller |ΔG|) wins.",
  },
  {
    id: "panel:SECTION PLANE",
    text: "A flat cut through the volume, the way a metallographer sections a casting to see inside it. "
      + "Depth, tilt and turn move the cut, and the style sets how its face is drawn.",
    hints: {
      // one line in the 252px popup (verify-rail counts its lines)
      "CT sweep": "sweeps the cut; pair with rec",
    },
  },
  {
    id: "panel:COOLING CURVE · PROBE",
    text: "Temperature against time at one spot, like a thermocouple in the melt. Where freezing starts, "
      + "released heat makes the curve flatten or rise (recalescence); ctrl-tap the melt to move the probe.",
  },
  {
    id: "panel:SCHEIL",
    // the dots are the GLOBAL f_s against the mean interface temperature
    // (analyze.ts, analyze3d.ts), so the gap is not only back-diffusion
    text: "Scheil's equation predicts the interface temperature as the solid fraction grows, assuming solute "
      + "never diffuses in the solid and mixes completely in the liquid. The cyan dots are what the solver "
      + "measured; the gap shows what those assumptions leave out (back-diffusion, solute pile-up in the "
      + "liquid, undercooling, uneven temperature).",
  },
  {
    id: "panel:TEXTURE · GRAIN ORIENTATION ROSE",
    text: "A histogram of grain orientations, weighted by area. A spike means many grains point the same way "
      + "(a texture); a flat rose means random grains.",
  },
  {
    id: "panel:STEREOLOGY",
    text: "Compares grain size measured on the flat section with the true 3D grains. A plane cuts most grains "
      + "away from their centers, so a 2D micrograph reads them small.",
  },
  {
    id: "panel:POLE FIGURE [001]",
    text: "Each dot is one grain's crystal [001] axis, projected onto the sample plane (the center is the "
      + "sample's z axis) and sized by volume. Dots that cluster mean the grains share a growth direction.",
  },
  {
    id: "panel:POLE FIGURE",
    text: "The same projection for every symmetry axis of each grain: three ⟨100⟩ axes in a cubic crystal, "
      + "the (0001) c axis in a hexagonal one. A texture shows as clusters instead of an even scatter.",
  },
];

registerLearn(PANEL_LEARN);

/** the text of a `panel:` entry (every id used below is declared above) */
export function panelText(name: string): string {
  return PANEL_LEARN.find(e => e.id === `panel:${name}`)?.text ?? "";
}

/** `panel:<name>|<label>` for every hint a panel has attached so far */
const hintsBound = new Set<string>();

/**
 * Attach the `panel:<name>` entry's hint for `ctrl`, looked up by the label
 * the control PRINTS (its first span: a formbits row's label, the SECTION
 * PLANE's "CT sweep"), so a hint cannot silently drop off a control whose
 * printed label drifted from the entry's key: `panelLearnAudit()` lists it.
 */
export function panelHintFor(layer: LearnLayer, name: string, ctrl: HTMLElement): void {
  const label = (ctrl.querySelector("span")?.textContent ?? "").trim();
  const text = PANEL_LEARN.find(e => e.id === `panel:${name}`)?.hints?.[label];
  if (!text) return;
  layer.hint(ctrl, text);
  hintsBound.add(`panel:${name}|${label}`);
}

/** the panel hints declared against those some panel bound (verify-rail RAIL-LEARN) */
export function panelLearnAudit(): { hintsDeclared: number; hintsUnbound: string[] } {
  const declared = PANEL_LEARN.flatMap(e => Object.keys(e.hints ?? {}).map(k => `${e.id}|${k}`));
  return { hintsDeclared: declared.length, hintsUnbound: declared.filter(k => !hintsBound.has(k)) };
}

// ------------------------------------------------------------ lab mode

export const LAB_CAVEATS = {
  /** the atmosphere is a cleanliness proxy; its scope depends on the dimension.
   *  "bulk": oxide films ARE nucleation sites (on the walls), so the line
   *  would contradict itself without it. In 2D it also moves the report's
   *  dissolved-hydrogen line (Sievert √p, porosity.ts PH2), just not a pore field */
  atmosphere2d: {
    line: "cleanliness proxy, not a bulk-nucleation control · walls and H readout only (pores need TRUE 3D)",
    learn: "Atmosphere stands for how clean the melt is. Air leaves oxide films that give the walls extra "
      + "places to start grains and lets more hydrogen dissolve (the report's H line), but it does not make "
      + "the bulk liquid freeze any more easily; gas pores only form in TRUE 3D.",
  },
  atmosphere3d: {
    line: "cleanliness proxy, not a bulk-nucleation control · acts on the walls and the porosity",
    learn: "Atmosphere stands for how clean the melt is. Air leaves oxide films that give the walls extra "
      + "places to start grains and lets more hydrogen dissolve, which raises the gas porosity; it does not "
      + "make the bulk liquid freeze any more easily.",
  },
  specNoConstants: {
    line: "no σ₀, k_HP for this material: the verdict will be refused",
    learn: "A strength verdict needs this material's Hall–Petch constants (σ₀ and k_HP). Without them the "
      + "report refuses to judge rather than guess.",
  },
  specNeeds: {
    line: "",
    learn: "Smaller grains make a stronger casting (Hall–Petch). More inoculant, a shorter hold and a faster "
      + "cooling program all make the grains finer.",
  },
  specTooFine: {
    line: "finer than the grid resolves: not reachable at this resolution",
    // not "a finer µm per cell would": that is a declared scale, and changing
    // it relabels the same casting (and its Hall–Petch strength) in microns
    learn: "The grain size this spec needs is smaller than the grid can draw, so no pour at this resolution "
      + "can honestly meet it. The micron scale comes from µm per cell (SCALE), which sets every size and "
      + "strength the report prints.",
  },
  probeIsLiquidMean: {
    line: "T = mean of the remaining liquid, not a fixed thermocouple · trace ends at the solidus",
    learn: "The temperature trace averages the liquid that is left. As cold regions freeze they leave that "
      + "average, so part of any recalescence shown comes from that; the trace stops at the solidus because "
      + "no liquid is left to read.",
  },
  hallPetch: {
    line: "grain size only: no precipitates, no work hardening",
    learn: "This strength counts grain size alone; precipitates and work hardening are not modeled. The "
      + "microns come from the resolution you set, so the strength inherits that choice.",
  },
  missedAsCast: {
    line: "needs a finer pour",
    learn: "Only finer as-cast grains raise the strength here: more inoculant, a shorter hold or faster "
      + "cooling. Heat treatment only coarsens grains, which lowers it.",
  },
  hotTear: {
    line: "timing ratio on the global f_s, not a stress model",
    learn: "CSC compares the time spent in the crack-prone last stage of freezing with the time the casting "
      + "can still be fed by liquid. It is a timing index on the whole casting; predicting real tears needs "
      + "stress and feeding physics this solver does not include.",
  },
  pores2d: {
    line: "pore field: TRUE 3D only",
    learn: "The hydrogen numbers are computed in either mode, but the pores themselves only form in the "
      + "TRUE 3D volume.",
  },
  siteModel: {
    line: "",
    // nuc.maxUndercool is the ratchet on tEq − meanLiqT (nucleation.ts
    // observe/update): the MEAN liquid, not a local maximum
    learn: "The deepest undercooling of the melt's mean liquid temperature that the nucleation model reached "
      + "(the level that fires its sites), a whole-melt measure, different from the ΔT_N read off the cooling curve.",
  },
  refinerFade: {
    line: "",
    learn: "A refiner held above the liquidus settles and clumps, so fewer sites are left when it is poured.",
  },
  intervened: {
    // no glyph: the report prints it as a warning line, whose "!" is CSS
    line: "conditions changed mid-run: a demonstration, not a measurement",
    learn: "A physics setting changed while the metal was freezing, so the run no longer matches the setup "
      + "it reports. Pour again without touching the dials to measure.",
  },
} as const satisfies Record<string, Caveat>;

/** explanations of the report's cards, keyed by card title */
export const LAB_CARDS: Readonly<Record<string, string>> = {
  "COOLING CURVE": "The melt's temperature against time. Freezing releases latent heat, so the curve flattens "
    + "or even rises (recalescence) where grains start; the gray trace is its slope, dT/dt.",
  "COOLING-CURVE ANALYSIS": "Landmarks read off the curve the way a foundry reads a test casting: where freezing "
    + "starts (T_L), how far the melt undercooled before grains took off (ΔT_N) and where the last liquid froze (T_S).",
  "AS-CAST STRENGTH": "Yield strength from grain size (Hall–Petch): smaller grains block dislocations, so the "
    + "casting is stronger.",
  "SECTION TABLE · THINNEST FIRST": "One pour, four section thicknesses, each measured on its own; thin sections "
    + "freeze faster and grow finer grains. A grain that crosses two sections counts in both, as in a "
    + "metallographer's per-field count.",
  "RUN SUMMARY": "How the nucleation model, the refiner, the hot-tear index and the dissolved hydrogen behaved "
    + "over the whole pour.",
};

// ------------------------------------------------------------ heat treat

export const HEAT_CAVEATS = {
  incipient: {
    line: "incipient melting",
    learn: "Near the melting point the grain boundaries start to melt (incipient melting). The model keeps "
      + "the solid frozen, so it cannot follow a schedule that would melt the part.",
  },
  domain: {
    line: "shorten the hold or lower the temperature",
    // the refusal DOES print the law's size ("law says N µm"); what it
    // declines is the Monte Carlo run, whose measured size would be meaningless
    learn: "The law's answer is printed, but grains that large leave too few in the simulated specimen to "
      + "average, so the panel will not run a treatment it could not measure. The law is Dⁿ − D₀ⁿ = ∫k dt "
      + "with this material's literature coefficients (rough for some materials).",
  },
  plan: {
    line: "",
    learn: "The material's law predicts the grain size after the whole schedule; the MC sweeps are how much "
      + "Monte Carlo grain growth that much time buys on this grid.",
  },
  noGrowth: {
    line: "no measurable growth",
    learn: "At this temperature atoms barely move, so the law predicts no growth. You can still run it, and "
      + "the report will confirm it.",
  },
  coldWork: {
    line: "law endpoint is withdrawn · a drive, not a strength",
    learn: "The grain-growth law was fitted without stored deformation energy, so with cold work on the panel "
      + "stops predicting the final size and measures it after the run. Cold work here only pushes boundaries; "
      + "it adds no work-hardening strength.",
  },
  coldWorkFewSweeps: {
    // no primary recrystallization at ANY temperature (no new grains
    // nucleate), so the line must not read as a limit of this window only
    line: "almost no sweeps at this temperature: no recrystallization anneal (new strain-free grains are not modeled)",
    learn: "The furnace turns time into grain-growth steps using the grain-growth law, so it cannot yet run "
      + "a low-temperature recrystallization anneal, and new strain-free grains are not modeled.",
  },
  specWithdrawn: {
    line: "judged on the measured census after the run",
    learn: "With the endpoint withdrawn there is nothing to predict the spec against, so the report judges "
      + "it on the grains measured after the run.",
  },
  specUnreachable: {
    line: "no anneal reaches it (coarser is softer) · needs a finer casting",
    learn: "Annealing only makes grains bigger, and bigger grains are weaker. A spec above today's strength "
      + "needs a finer casting, not a hotter furnace.",
  },
  pin3d: {
    line: "pins in 3D; d_lim measured in 2D only, not claimed",
    learn: "Particles pin boundaries in the volume too, but the size they stop growth at has only been "
      + "measured in 2D, so no number is claimed here.",
  },
  pinStalls: {
    line: "furnace stalls: a dispersion cannot refine grains already past it",
    learn: "Particles hold grain boundaries at a limiting size. If the grains are already larger than that, "
      + "the particles stop growth but cannot make grains smaller.",
  },
  pinClips: {
    line: "law endpoint not reached (stalls at d_lim)",
    learn: "The particles stop growth at d_lim before the schedule's law endpoint, so the furnace stalls there.",
  },
  lawPath: {
    line: "path between: Potts model",
    learn: "The endpoint comes from the material's grain-growth law, starting from the measured casting; the "
      + "path between them is the simulation's own grain-growth model (Potts).",
  },
  lawWithdrawn: {
    line: "stored-energy drive outside the fitted law; before and after are measured",
    learn: "The law's coefficients describe growth driven by boundary curvature alone. This run also carried "
      + "stored energy, so no endpoint is predicted and the rows above are measurements only.",
  },
  hallPetch: {
    line: "grain size only: no precipitates, no work hardening",
    learn: "This strength counts grain size alone. The microns come from the resolution you set, so the "
      + "strength inherits that choice.",
  },
  hallPetchWork: {
    line: "grain size only: no precipitates, no work hardening (cold work is a drive, not a strength)",
    learn: "This strength counts grain size alone. A real cold-worked bar would also be work hardened, which "
      + "this model leaves out, so annealing a worked casting here only makes it softer.",
  },
  missedAsCast: {
    line: "under spec as cast too: needs a finer pour",
    learn: "An anneal only softens a casting, so a spec it already missed before the furnace can only be met "
      + "by pouring finer grains.",
  },
  missedTrade: {
    line: "strength traded for grain size (Hall–Petch)",
    learn: "Annealing grew the grains, and bigger grains are weaker: that is the Hall–Petch trade.",
  },
  twins: {
    line: "",
    learn: "Annealing twins form on grain boundaries as they move, in metals with a low stacking-fault "
      + "energy such as copper.",
  },
  twinsSaturated: {
    line: "grain-id range exhausted: delivered count, not rate",
    learn: "The simulation ran out of new grain labels partway through, so this is how many twins it could "
      + "make, not how many the rate asked for.",
  },
  twinsHeldBack: {
    line: "held back while cold work is dialed: twinning in deformed grains is not modeled yet",
    learn: "Twins and cold work are not simulated together yet: a new twin could start with the wrong stored "
      + "energy and be consumed by its parent grain.",
  },
  homogBelowRes: {
    line: "below resolution",
    learn: "Homogenizing spreads solute by diffusion; here it would move solute less than one grid cell, too "
      + "little to see at this resolution.",
  },
  /** only when the plan itself predicted no growth (the note's no-growth branch) */
  noChange: {
    line: "no microstructural change, as predicted (a stress relief)",
    learn: "A stress relief is meant to leave the grains alone; it relaxes internal stress, which this model "
      + "does not track.",
  },
  /** the law predicted growth and the census barely moved */
  noChangeGrew: {
    line: "no measurable change (law predicted growth)",
    learn: "The law predicted some growth, but the measured mean grain size moved by less than 0.05 µm. A "
      + "small predicted change can be lost in the Monte Carlo run's noise.",
  },
  /** …with a dispersion dialed, which can hold the boundaries where they are */
  noChangePinned: {
    line: "no measurable change (law predicted growth; the dispersion pins boundaries)",
    learn: "The law's prediction leaves the particles out. A dispersion holds grain boundaries in place, so it "
      + "can stop the growth the law predicted.",
  },
  noChangeWorked: {
    line: "no microstructural change (none predicted: endpoint withdrawn)",
    learn: "With the stored-energy drive on, no endpoint was predicted, so this row reports the measurement, "
      + "not a hit.",
  },
  coldWorkRow: {
    line: "",
    learn: "Recovery removes stored energy fastest from the most deformed grains, so the differences between "
      + "grains, which drive boundary motion, shrink faster than the average.",
  },
} as const satisfies Record<string, Caveat>;

// ------------------------------------------------------------ optimizer

export const OPT_CAVEATS = {
  intro: {
    line: "CMA-ES · 1 tile = 1 casting · goal |ΔG| → 0",
    learn: "Early castings look chaotic while the search explores; when it converges it stops and reports the "
      + "winning recipe, which apply loads into the instrument.",
  },
  stalled: {
    line: "",
    learn: "The search stopped improving before it reached the target: this is the best recipe it found, not "
      + "a converged one. Keep searching or move the target.",
  },
} as const satisfies Record<string, Caveat>;

// ------------------------------------------------------------ status lines

export const STATUS_LEARN = {
  armed: "The melt is set up and waiting: tap to place seeds and change any control, then press ▶ run.",
  stereology: "For equal spheres a random section reads √(2/3) ≈ 0.82 of the true diameter (compared by mean "
    + "area, as here); a wide size spread or long grains can read higher.",
  niyamaModel: "The Niyama number marks where shrinkage pores are likely. This material has no real temperature "
    + "or time, so the map only ranks regions against each other.",
  niyamaSteel: "The Niyama criterion marks regions that freeze with too shallow a temperature gradient to be fed "
    + "by liquid; below Ny_crit, steel castings showed shrinkage pores on radiographs. Gas porosity is a separate "
    + "mechanism (the lab report's hydrogen line).",
  niyamaOther: "The Niyama threshold was measured on steel radiographs, so for other alloys the map only ranks "
    + "regions by shrinkage risk. It does not cover dissolved-gas porosity.",
} as const;
