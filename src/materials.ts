import type { PhysParams } from "./sim";
import type { MaterialSI } from "./units";

// Material identities: qualitative mappings of real solidifying materials onto
// the dimensionless model. Crystal structure fixes the dendrite symmetry
// (FCC/BCC -> 4-fold <100> arms in 2D, HCP -> 6-fold basal arms); anisotropy
// strength, latent heat, and the alloy bundle are scaled to reproduce each
// material's characteristic morphology, not its absolute numbers. meltGlow is
// display-only: how brightly the melt actually glows at its freezing point.
//
// `si` is the separate, REAL half: the SI properties units.ts needs to put a
// thermometer and a clock on the dimensionless solver. `params` stays exactly as
// it was — the two blocks are independent on purpose, so adding real units
// cannot perturb a single existing morphology.

export interface Material {
  label: string;
  note: string;                 // one-line fact shown under the picker
  params: Partial<PhysParams>;
  /** real SI properties; absent for materials that are not substances */
  si?: MaterialSI;
}

/** map a material's 2D symmetry onto the 3D anisotropy model */
export interface Map3D {
  aniMode3: 0 | 1 | 2 | 3;   // 0 iso, 1 cubic <100>, 2 hex basal plates, 3 icosahedral
  delta: number;
  deltaZ: number;
  supported: boolean;
  note3d?: string;
}

export function to3D(m: Material): Map3D {
  const j = m.params.aniMode ?? 4;
  const delta = Math.min(m.params.delta ?? 0.04, 0.06);
  if (j === 6) return { aniMode3: 2, delta, deltaZ: 0.03, supported: true };
  if (j === 4) return { aniMode3: 1, delta, deltaZ: 0, supported: true };
  // the 2D "forbidden" 5/10-fold get the genuine 3D quasicrystal answer:
  // icosahedral anisotropy (six 5-fold axes)
  if (j === 5 || j === 10) return { aniMode3: 3, delta: 0.02, deltaZ: 0, supported: true };
  // 2/3-fold have no dedicated 3D class here — fall back to cubic
  return {
    aniMode3: 1, delta: 0.03, deltaZ: 0, supported: false,
    note3d: "this symmetry is 2D-only — growing as a model cubic metal in 3D",
  };
}

export const MATERIALS: Record<string, Material> = {
  generic: {
    label: "model metal (pure)",
    note: "Kobayashi's dimensionless pure metal — the reference crystal every phase-field paper grows first.",
    params: { aniMode: 4, delta: 0.04, latent: 1.6, alloyOn: 0, meltGlow: 1.0 },
  },
  al: {
    label: "aluminum · Al–Cu",
    note: "FCC, ⟨100⟩ arms. Freezes at 660 °C, so the melt only glows dull red. Al castings grow feathery twinned grains — try the twin rate slider.",
    params: { aniMode: 4, delta: 0.045, latent: 1.35, alloyOn: 1, c0: 0.3, mLiq: 0.5, kPart: 0.14, dSol: 0.9, meltGlow: 0.55 },
    si: {
      Tm: 933.5, L: 397e3, cp: 1180, rho: 2385,
      alphaTh: 3.23e-5, Dl: 3.5e-9, Ds0: 6.5e-5, Qs: 136e3,
      mL: -3.4, kPart: 0.17, Gamma: 2.4e-7, eps4: 0.02,
      ggA0: 1.2e-4, ggQ: 142e3, ggN: 2,
      oxA0: 1e-14, oxQ: 120e3,
      s0: 20, kHP: 0.07,
      sfe: 166,
      source: "Al–4Cu. Solid-state diffusion and the liquidus slope are Cu in Al; Γ and ε₄ are the standard Al–Cu values. Alumina is protective, so the oxidation constant is deliberately tiny — aluminium does not scale. SFE 166 mJ/m² (Murr 1975 compilation) — the textbook example of a metal too high-SFE for annealing twins.",
    },
  },
  steel: {
    label: "steel · Fe–C",
    note: "BCC δ-ferrite, 4-fold ⟨100⟩ dendrites. Pours at ~1540 °C — white-hot, the brightest melt here.",
    params: { aniMode: 4, delta: 0.03, latent: 1.8, alloyOn: 1, c0: 0.35, mLiq: 0.5, kPart: 0.3, dSol: 0.7, meltGlow: 1.0 },
    si: {
      Tm: 1811, L: 247e3, cp: 820, rho: 7030,
      alphaTh: 5.72e-6, Dl: 1.1e-8, Ds0: 2.0e-6, Qs: 84.1e3,
      mL: -78, kPart: 0.17, Gamma: 1.9e-7, eps4: 0.02,
      ggA0: 4.3e-3, ggQ: 250e3, ggN: 2,
      oxA0: 6e-6, oxQ: 170e3,
      s0: 70, kHP: 0.6,
      twinNote: "this steel is modelled as BCC δ-ferrite, and annealing twins are an austenite (FCC) phenomenon — the solver has no γ phase to grow them in.",
      source: "Fe–C through δ-ferrite. Carbon is interstitial, so its liquid diffusivity sits an order above a substitutional solute's, and the liquidus slope is correspondingly steep. Mill scale is real and fast — tens of µm in an hour at 900 °C.",
    },
  },
  ni: {
    label: "nickel superalloy",
    note: "Turbine-blade metal, grown as one single crystal in a Bridgman furnace — try the BRIDGMAN scenario.",
    params: { aniMode: 4, delta: 0.04, latent: 1.7, alloyOn: 1, c0: 0.3, mLiq: 0.4, kPart: 0.35, dSol: 0.6, meltGlow: 0.95 },
    si: {
      Tm: 1728, L: 298e3, cp: 735, rho: 7810,
      alphaTh: 5.23e-6, Dl: 3.0e-9, Ds0: 1.4e-4, Qs: 260e3,
      mL: -10.5, kPart: 0.48, Gamma: 3.65e-7, eps4: 0.018,
      ggA0: 2.0e-3, ggQ: 280e3, ggN: 2,
      oxA0: 3e-8, oxQ: 200e3,
      s0: 200, kHP: 0.75,
      sfe: 128,
      source: "Ni–Nb as the superalloy proxy — niobium is the element that actually segregates in IN718. Chromia-forming, so oxidation is slow. SFE 128 mJ/m² for pure Ni (Murr 1975) — above the twinning band, though real superalloy chemistries push it lower.",
    },
  },
  co: {
    label: "cobalt alloy",
    note: "Surprise: Co freezes FCC, so its dendrites are 4-fold like steel's. It only turns HCP at 417 °C, long after solidifying.",
    params: { aniMode: 4, delta: 0.035, latent: 1.7, alloyOn: 1, c0: 0.3, mLiq: 0.45, kPart: 0.25, dSol: 0.7, meltGlow: 0.95 },
    si: {
      Tm: 1768, L: 275e3, cp: 590, rho: 7750,
      alphaTh: 9.84e-6, Dl: 3.0e-9, Ds0: 1.0e-4, Qs: 275e3,
      mL: -6, kPart: 0.5, Gamma: 3.4e-7, eps4: 0.02,
      ggA0: 1.5e-3, ggQ: 285e3, ggN: 2,
      oxA0: 5e-8, oxQ: 190e3,
      s0: 220, kHP: 0.7,
      sfe: 20,
      source: "Generic dilute Co-base alloy. The least well characterised entry here — the solute numbers are order-of-magnitude, not a specific system. SFE ≈ 20 mJ/m²: FCC Co alloys sit among the lowest-SFE metals (Co–33Ni ≈ 20, Co–Cr implant alloys 15–50 mJ/m²), which is why they twin profusely.",
    },
  },
  cu: {
    label: "copper · bronze",
    note: "The oldest cast metal — bronze bells, brass fittings. FCC, freezes at 1085 °C with an honest orange glow.",
    params: { aniMode: 4, delta: 0.04, latent: 1.6, alloyOn: 1, c0: 0.3, mLiq: 0.45, kPart: 0.2, dSol: 0.8, meltGlow: 0.8 },
    si: {
      Tm: 1358, L: 209e3, cp: 490, rho: 8020,
      alphaTh: 4.20e-5, Dl: 4.0e-9, Ds0: 1.1e-5, Qs: 180e3,
      mL: -10, kPart: 0.35, Gamma: 2.36e-7, eps4: 0.02,
      ggA0: 3.0e-4, ggQ: 197e3, ggN: 2,
      oxA0: 2e-6, oxQ: 150e3,
      s0: 25, kHP: 0.11,
      sfe: 78,
      source: "Cu–Sn (bronze). The Cu–Sn liquidus is strongly curved toward the peritectic, so mL here is the dilute-limit slope, not an average over the range. SFE 78 mJ/m² (Murr 1975) — under the twinning band's edge, which is why annealed copper and brass are full of Σ3 twins.",
    },
  },
  mg: {
    label: "magnesium · AZ91",
    note: "HCP — a metal that grows genuine 6-fold dendrites, snowflakes in magnesium.",
    params: { aniMode: 6, delta: 0.04, latent: 1.5, alloyOn: 1, c0: 0.35, mLiq: 0.5, kPart: 0.35, dSol: 0.8, meltGlow: 0.6 },
    si: {
      Tm: 923, L: 349e3, cp: 1360, rho: 1590,
      alphaTh: 3.61e-5, Dl: 3.0e-9, Ds0: 1.2e-4, Qs: 143e3,
      mL: -6.9, kPart: 0.37, Gamma: 1.6e-7, eps4: 0.02,
      ggA0: 8.0e-5, ggQ: 135e3, ggN: 2,
      oxA0: 5e-5, oxQ: 140e3,
      s0: 40, kHP: 0.28,
      source: "AZ91 (Mg–Al). Two numbers are deliberately extreme and both are real: the oxidation constant, because MgO does not protect and magnesium burns in air, and the Hall–Petch slope, which is famously large in HCP metals.",
    },
  },
  zn: {
    label: "zinc · spangle",
    note: "The spangle on galvanized steel is exactly this: HCP 6-fold crystals. At 420 °C the melt does not glow at all — just liquid silver.",
    params: { aniMode: 6, delta: 0.045, latent: 1.6, alloyOn: 0, meltGlow: 0.3 },
    si: {
      Tm: 692.7, L: 112e3, cp: 480, rho: 6570,
      alphaTh: 1.90e-5, Dl: 3.0e-9, Ds0: 1.0e-5, Qs: 96e3,
      mL: -5, kPart: 0.4, Gamma: 1.4e-7, eps4: 0.02,
      ggA0: 5.0e-5, ggQ: 92e3, ggN: 2,
      oxA0: 1e-8, oxQ: 120e3,
      s0: 35, kHP: 0.22,
      source: "Pure Zn — the galvanized spangle. Ships with the solute field off, so mL and k are nominal placeholders rather than a measured system.",
    },
  },
  ice: {
    label: "water · ice",
    note: "Hexagonal ice — the one fact behind every 6-armed snowflake. Twinned seeds grow the rare 12-branched flake.",
    params: { aniMode: 6, delta: 0.04, latent: 1.8, noiseAmp: 0.014, alloyOn: 0, meltGlow: 0.12 },
    si: {
      Tm: 273.15, L: 334e3, cp: 4186, rho: 1000,
      alphaTh: 1.43e-7, Dl: 1.0e-9, Ds0: 1e-12, Qs: 60e3,
      mL: -1.86, kPart: 0.001, Gamma: 1.0e-7, eps4: 0.006,
      ggA0: 1e-9, ggQ: 60e3, ggN: 2,
      oxA0: 0, oxQ: 0,
      s0: 0.5, kHP: 0.005,
      source: "Water / ice Ih. Its thermal diffusivity is four orders below a metal's, mL is the cryoscopic constant, and k is nearly zero — ice rejects almost everything, which is why sea ice makes brine.",
    },
  },
  scn: {
    label: "succinonitrile (SCN)",
    note: "NASA's transparent model metal — flown on the Space Shuttle to film dendrites growing. Weak anisotropy, soft rounded tips.",
    params: { aniMode: 4, delta: 0.012, latent: 1.4, noiseAmp: 0.016, alloyOn: 0, meltGlow: 0.18 },
    si: {
      Tm: 331.2, L: 46.24e3, cp: 2000, rho: 988,
      alphaTh: 1.13e-7, Dl: 1.27e-9, Ds0: 1e-13, Qs: 50e3,
      mL: -2.8, kPart: 0.1, Gamma: 6.48e-8, eps4: 0.0055,
      ggA0: 1e-10, ggQ: 40e3, ggN: 2,
      oxA0: 0, oxQ: 0,
      s0: 0.1, kHP: 0.001,
      twinNote: "succinonitrile freezes BCC (a plastic crystal), and annealing twins are essentially an FCC phenomenon — BCC metals show them only rarely.",
      source: "Succinonitrile–acetone: THE quantitative phase-field benchmark. Γ = 6.48e-8 K·m and ε₄ = 0.0055 are the canonically measured values, which is why the calibrated solver is validated against this material first.",
    },
  },
  qc: {
    label: "Al–Co–Ni · quasicrystal",
    note: "Decagonal quasicrystal: ordered but never repeating, with the 10-fold symmetry no periodic lattice is allowed (Shechtman, Nobel 2011). Here only the interface-energy symmetry is modelled.",
    params: { aniMode: 10, delta: 0.022, latent: 1.5, noiseAmp: 0.008, alloyOn: 1, c0: 0.3, mLiq: 0.45, kPart: 0.3, dSol: 0.7, meltGlow: 0.7 },
  },
};
