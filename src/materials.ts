import type { PhysParams } from "./sim";

// Material identities: qualitative mappings of real solidifying materials onto
// the dimensionless model. Crystal structure fixes the dendrite symmetry
// (FCC/BCC -> 4-fold <100> arms in 2D, HCP -> 6-fold basal arms); anisotropy
// strength, latent heat, and the alloy bundle are scaled to reproduce each
// material's characteristic morphology, not its absolute numbers. meltGlow is
// display-only: how brightly the melt actually glows at its freezing point.

export interface Material {
  label: string;
  note: string;                 // one-line fact shown under the picker
  params: Partial<PhysParams>;
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
  },
  steel: {
    label: "steel · Fe–C",
    note: "BCC δ-ferrite, 4-fold ⟨100⟩ dendrites. Pours at ~1540 °C — white-hot, the brightest melt here.",
    params: { aniMode: 4, delta: 0.03, latent: 1.8, alloyOn: 1, c0: 0.35, mLiq: 0.5, kPart: 0.3, dSol: 0.7, meltGlow: 1.0 },
  },
  ni: {
    label: "nickel superalloy",
    note: "Turbine-blade metal, grown as one single crystal in a Bridgman furnace — try the BRIDGMAN scenario.",
    params: { aniMode: 4, delta: 0.04, latent: 1.7, alloyOn: 1, c0: 0.3, mLiq: 0.4, kPart: 0.35, dSol: 0.6, meltGlow: 0.95 },
  },
  co: {
    label: "cobalt alloy",
    note: "Surprise: Co freezes FCC, so its dendrites are 4-fold like steel's. It only turns HCP at 417 °C, long after solidifying.",
    params: { aniMode: 4, delta: 0.035, latent: 1.7, alloyOn: 1, c0: 0.3, mLiq: 0.45, kPart: 0.25, dSol: 0.7, meltGlow: 0.95 },
  },
  cu: {
    label: "copper · bronze",
    note: "The oldest cast metal — bronze bells, brass fittings. FCC, freezes at 1085 °C with an honest orange glow.",
    params: { aniMode: 4, delta: 0.04, latent: 1.6, alloyOn: 1, c0: 0.3, mLiq: 0.45, kPart: 0.2, dSol: 0.8, meltGlow: 0.8 },
  },
  mg: {
    label: "magnesium · AZ91",
    note: "HCP — a metal that grows genuine 6-fold dendrites, snowflakes in magnesium.",
    params: { aniMode: 6, delta: 0.04, latent: 1.5, alloyOn: 1, c0: 0.35, mLiq: 0.5, kPart: 0.35, dSol: 0.8, meltGlow: 0.6 },
  },
  zn: {
    label: "zinc · spangle",
    note: "The spangle on galvanized steel is exactly this: HCP 6-fold crystals. At 420 °C the melt does not glow at all — just liquid silver.",
    params: { aniMode: 6, delta: 0.045, latent: 1.6, alloyOn: 0, meltGlow: 0.3 },
  },
  ice: {
    label: "water · ice",
    note: "Hexagonal ice — the one fact behind every 6-armed snowflake. Twinned seeds grow the rare 12-branched flake.",
    params: { aniMode: 6, delta: 0.04, latent: 1.8, noiseAmp: 0.014, alloyOn: 0, meltGlow: 0.12 },
  },
  scn: {
    label: "succinonitrile (SCN)",
    note: "NASA's transparent model metal — flown on the Space Shuttle to film dendrites growing. Weak anisotropy, soft rounded tips.",
    params: { aniMode: 4, delta: 0.012, latent: 1.4, noiseAmp: 0.016, alloyOn: 0, meltGlow: 0.18 },
  },
  qc: {
    label: "Al–Co–Ni · quasicrystal",
    note: "Decagonal quasicrystal: ordered but never repeating, with the 10-fold symmetry no periodic lattice is allowed (Shechtman, Nobel 2011). Here only the interface-energy symmetry is modelled.",
    params: { aniMode: 10, delta: 0.022, latent: 1.5, noiseAmp: 0.008, alloyOn: 1, c0: 0.3, mLiq: 0.45, kPart: 0.3, dSol: 0.7, meltGlow: 0.7 },
  },
};
