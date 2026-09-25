/**
 * Learn mode for the control rail (v8 U1a). One entry per rail section, keyed
 * `sec:<title>` exactly as the tour highlights it; hints keyed by the label
 * the control prints; and the rail's own caveats as line + learn pairs.
 *
 * Rules (docs/COPY-STYLE.md): 1 to 2 sentences, plain words, for a student
 * reading once; what the thing is and why it matters, the physics last; no em
 * dashes; controls named exactly as printed; American spelling. A hint is ONE
 * line under its control (verify-rail.mjs RAIL-LEARN measures it), so keep it
 * under about 45 characters.
 *
 * The per-material sentences live beside each material's note in
 * materials.ts, and the SCALE group sentences beside their notes in units.ts,
 * because those modules compute the on-screen half too.
 */
import { registerLearn, type Caveat, type LearnEntry } from "./index";

export const RAIL_LEARN: readonly LearnEntry[] = [
  {
    id: "sec:PRESETS",
    text: "Ready-made starting points, each a material, a scenario and settings that show one kind of growth. "
      + "Load one, then change a single control to see what it does.",
  },
  {
    id: "sec:MATERIAL",
    text: "Which substance is freezing. Its crystal structure sets how many arms a dendrite grows, and a real "
      + "material puts kelvin, seconds and microns on the readouts.",
  },
  {
    id: "sec:MODES",
    text: "In lab mode you pour a planned experiment (mold, superheat, cooling program) and get its cooling "
      + "curve and grains; heat treat anneals the frozen casting in real hours. The optimizer searches for "
      + "a process that hits a target grain size, and challenge pits you against it (both 2D only).",
  },
  {
    id: "sec:MELT · PROCESS",
    text: "The melt's starting state and how fast heat leaves it. More undercooling, faster cooling and more "
      + "refiner particles all give more grains, and smaller ones.",
    hints: {
      "undercooling": "how far below melting the melt starts",
      "cooling rate": "how fast the whole melt loses heat",
      "inoculant n_max": "refiner particles that can each start a grain",
    },
  },
  {
    id: "sec:SCENARIO",
    text: "Where heat leaves the melt, which decides the shape of the grains: free cools it evenly, bridgman "
      + "pulls it through a temperature gradient (how turbine blades are grown), weld drags a laser pool "
      + "across it, and selector (TRUE 3D only) filters many grains down to one.",
    hints: {
      "gradient": "temperature change per unit length",
      "gradient (3D)": "temperature change per unit length",
      "pull speed": "how fast the melt moves through the gradient",
      "laser power": "heat the laser puts in",
      "spot size": "laser spot radius",
      "auto raster": "sweeps the laser; tap the melt to steer",
      "sweep speed": "how fast the laser travels",
    },
  },
  {
    id: "sec:ALLOY",
    text: "Adds one dilute solute that the growing crystal pushes into the liquid. It piles up at the "
      + "interface, slows growth and makes the casting segregate; without the calibrated solver it is a "
      + "qualitative model.",
    hints: {
      // "dilute" was the checkbox's own word until U1a cut the label to
      // "solute field"; the calibrated solver's alloy model is quantitative
      // (anti-trapping on), so the qualifier is conditional
      "solute field": "a dilute solute, qualitative unless calibrated",
      "alloy composer…": "build a real alloy, element by element",
      "composition c₀": "how much solute, in model units",
      "liquidus slope": "how far solute lowers the freezing point",
      "solute D": "how fast solute spreads in the liquid",
    },
  },
  {
    id: "sec:CRYSTAL",
    text: "How the crystal's structure steers growth. Anisotropy makes some directions grow faster, and the "
      + "symmetry sets how many arms: a repeating lattice allows only 2, 3, 4 or 6-fold, so 5 and 10-fold "
      + "are quasicrystals.",
    hints: {
      "anisotropy δ": "direction preference; near 0 grows seaweed",
      "faceted (cusped ε)": "flat facets, the way silicon grows",
      "tip noise": "random kicks that start side branches",
      "latent heat K": "heat released as the melt freezes",
      "twin rate": "chance of a growth twin at the front",
      "habit δz": "c-axis bias: − grows needles, + plates",
    },
  },
  {
    id: "sec:LOOK",
    text: "How the picture is drawn, not what is simulated. The stains and maps copy how a metallographer "
      + "makes grains visible under the microscope.",
    hints: {
      "pixel mode": "draw the field as large pixels",
      "8-bit palette": "retro palette with dithering",
      "VOXEL MODE": "draw the volume as cubes",
      "stain": "tint etch: colors grains by orientation",
      "EBSD map (ORIENT)": "flat color per grain orientation",
    },
  },
  {
    id: "sec:ENGINE",
    text: "How the solver runs: speed, brush, grid size and the random seed. A bigger grid is a bigger piece "
      + "of metal at the same resolution, so it runs slower.",
    hints: {
      "speed": "solver steps per frame",
      "speed (3D)": "solver steps per frame",
      "brush size": "size of a tapped seed",
      "grid": "grid edge in cells (µm per cell: SCALE)",
    },
  },
  {
    id: "sec:ANALYZE",
    text: "Measurement tools, the way a metallurgist reads a casting. The probe records a cooling curve, "
      + "Scheil predicts how solute segregates, the rose counts grain orientations, and the ruler measures "
      + "secondary arm spacing (SDAS).",
    hints: {
      "cooling probe": "ctrl-tap the melt to move it",
      "Scheil overlay": "predicted vs measured freezing path",
      "texture rose": "histogram of grain orientations",
      "SDAS ruler": "drag a line across the side arms",
    },
  },
  {
    id: "sec:VOLUME · 3D",
    text: "Tools for the TRUE 3D volume. Stereology shows how much a flat section under-measures grain size, "
      + "and the two pole figures show which way the grains' crystal axes point.",
    hints: {
      // "usually": the panel's ratio compares the mean-section-area diameter
      // with the volume-equivalent one, which is √(2/3) ≈ 0.82 for equal
      // spheres (U1b corrected the panel's old π/4, the mean-diameter ratio);
      // a broad size spread or columnar grains cut lengthwise can read 1 or more
      "stereology (2D section vs 3D)": "a flat section usually reads grains small",
      // v8 U1b: this panel was "IPF map"; it plots each grain's [001] axis in
      // the sample frame, which is a pole figure (analyze3d.ts)
      "pole figure [001]": "each grain's [001] axis, sized by volume",
      "pole figure ⟨100⟩ / (0001)": "every symmetry axis of each grain",
    },
  },
  {
    id: "sec:ADVANCED",
    text: "The model's own dials: interface, kinetics, solute partition and the nucleation sites. Calibrated "
      + "mode derives several from the material, which is why they gray out there.",
    hints: {
      "interface ε̄": "interface energy; sets its thickness",
      "kinetics γ": "how strongly undercooling drives growth",
      "driving α": "cap on the driving force",
      "relax τ ×10⁻⁴": "interface relaxation time",
      "partition k": "share of solute the solid keeps",
      "site ΔT_N": "undercooling at which a typical site fires",
      "site spread σ": "spread of site undercoolings",
      "copy setup link": "saves material, settings, lens and recipe",
    },
  },
  {
    id: "sec:SCALE",
    text: "The map from the solver's dimensionless numbers to real units, and where each factor comes from. "
      + "The groups below say which real ratios the model matches and which it cannot, so you know which "
      + "numbers to trust.",
    hints: {
      "coupling λ": "convergence knob: shrink it to check a result",
      "µm per cell": "model resolution, the one free scale",
    },
  },
];

registerLearn(RAIL_LEARN);

/** learn paragraphs that belong to a control or a group rather than a section */
export const RAIL_NOTES = {
  seed: "The seed fixes every random choice in the run: grain orientations, where the sites sit and when "
    + "they fire. Share links carry it, so the same casting pours again.",
  sites: "A well-inoculated foundry melt starts grains within a few kelvin of the liquidus; a clean melt "
    + "with no refiner needs tens of kelvin.",
  export: "STL saves the crystal as a watertight, printable mesh about 40 mm across; 360° records a 6 s "
    + "orbit as a WebM video.",
  regime: "Real processes cool at very different rates; this names the one whose rate matches the dial.",
} as const;

// δ is not set from Γ and D: calibrated mode takes it from the material's
// measured ε₄ (main.ts setSolver, `delta: si.eps4`)
const LOCKED = "In calibrated mode the grayed dials come from the material's measured data (W₀ and τ₀ from Γ "
  + "and D, δ from ε₄), so they are derived here, not chosen.";

/** the rail's own honesty caveats: `line` stays on screen, `learn` joins it in learn mode */
export const RAIL_CAVEATS = {
  rateDimensionless: {
    line: "dimensionless: pick a real material for units",
    // every material without SI data, the Al–Co–Ni quasicrystal included
    // (a real alloy with a melting point, carried here with no SI block)
    learn: "This material has no SI data here, so there is no clock or thermometer. Pick one that has it "
      + "to read the cooling rate in K/s.",
  },
  noRefiner: {
    line: "no refiner: chill wall and taps only",
    learn: "With no grain refiner in the melt, new crystals start only on a chilled wall or where you tap.",
  },
  sitesFire: {
    line: "sites fire on undercooling · rate not settable",
    learn: "Each refiner site switches on once the melt is cold enough for it. You set how many there are, "
      + "not how fast they fire: the cooling decides that.",
  },
  reheat: {
    line: "hold to remelt · not a heat treatment (see heat treat)",
    // uniform over the whole melt (main.ts reheat: a volumetric heatIn), so
    // not a "brush" a student would expect to heat where they point
    learn: "Holding reheat pours heat into the whole melt and melts solid back to liquid. It is not a heat "
      + "treatment: use heat treat for grain growth or homogenization.",
  },
  unreal: {
    line: "beyond any real melt (> ~0.2·T_m nucleates homogeneously) · model only",
    learn: "Real melts of this metal cannot get this cold: past about 0.2·T_m the liquid crystallizes on its "
      + "own, however clean it is. The run is a valid model, just not an experiment.",
  },
  relief: {
    line: "2D physics · height = freeze time",
    learn: "2.5D relief tilts the 2D picture and raises each spot by when it froze. The physics is still 2D; "
      + "switch on TRUE 3D for a real volume.",
  },
  scheilNeedsAlloy: {
    line: "needs the solute field (ALLOY)",
    learn: "Scheil's equation describes how an alloy rejects solute as it freezes, so there is nothing to "
      + "plot until the solute field is on.",
  },
  calOff: {
    line: "W₀, τ₀ from Γ, D",
    learn: "Calibrated mode computes the interface width W₀ and time τ₀ from this material's Gibbs–Thomson "
      + "coefficient Γ and diffusivity D. Tip radius and arm spacing then become predictions, not just shapes.",
  },
  calLocked: {
    line: "W₀, τ₀ from Γ, D · locked: ε̄ τ α γ δ, solute D, cell pitch",
    learn: LOCKED,
  },
  /** the title on each grayed dial; its learn half is shown once, under the calibration readout */
  derived: {
    line: "derived (calibrated mode)",
    learn: LOCKED,
  },
  cal3d: {
    line: "calibrated solver: 2D only",
    learn: "The calibrated solver runs in 2D only for now; the volume still uses the Kobayashi model.",
  },
  calNoSI: {
    line: "calibration needs SI data (Γ, D)",
    learn: "Calibration needs this material's measured Γ and D, and none are carried here. Pick a material "
      + "that has them.",
  },
  /** under site ΔT_N and σ when the material has no SI data: their values are not kelvin */
  sitesModelUnits: {
    line: "site ΔT_N, σ: model units (no SI identity)",
    learn: "This material has no real temperature scale, so these undercoolings are in the solver's own "
      + "units, not kelvin.",
  },
  grid3d: {
    line: "192³ = 7.1 M voxels · ~30 fps",
    learn: "A 192³ volume is about 7.1 million voxels and runs near 30 frames a second; 128³ runs at full speed.",
  },
} as const satisfies Record<string, Caveat>;
