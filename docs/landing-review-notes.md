# Landing page design review — taste-skill audit (2026-07-19)

Initial draft archived at `docs/landing-draft-1-2026-07-19.html`.

**Design read:** showcase landing for a scientific instrument; audience = engineers, PIs,
admissions readers; dark-tech instrument language; the live WebGPU sim is the hero asset.
Dials: DESIGN_VARIANCE 6 · MOTION_INTENSITY 4 (the demo provides the motion; page chrome stays
calm) · VISUAL_DENSITY 3.

## Findings in draft 1

| # | Finding | Rule | Fix |
|---|---------|------|-----|
| 1 | Fully centered symmetric hero | 4.3 anti-center bias at VARIANCE > 4 | Asymmetric split hero at desktop: copy + CTAs left, live demo right |
| 2 | CTAs below the fold on short windows (620px demo pushes them down) | 4.7 hero must fit viewport | Split hero fixes it; demo height capped ~70vh |
| 3 | Four equal feature cards | 9.C three-equal-cards ban | 2×2 asymmetric bento (7/5 – 5/7 fr) with one real image tile (snowflake still) |
| 4 | All-text cards, no visual variation | 4.7 bento background diversity | Snowflake image tile + tinted cell |
| 5 | Em-dashes in tagline + two card bodies; en-dash in "Warren–Boettinger" | 9.G zero-dash ban | Periods/colons/hyphens everywhere |
| 6 | Footer second line uses two middle-dots | 9.F dot ration (max 1/line) | Plain commas |
| 7 | Blurb ~65 words | 4.9 content density | Cut to ~40 words, split across hero copy + bento |
| 8 | RAW WEBGPU card = spec-list-ish filler | 4.9 | Replace card with a plain 4-stat strip (mono numbers, no card chrome) |
| 9 | Single centered 4-fold demo crystal could read as a swastika (user catch) | brand safety | Demo scene 1 now grows 3 scattered crystals; lone-crystal moment is the 6-fold snowflake |

Kept (pass): tinted glow shadow on demo box; amber CTA contrast (AA); dark theme locked
page-wide; no scroll cues / status dots / version labels / locale strips; live demo instead of
fake screenshots; monospace identity consistent with the instrument.

## Draft 2 structure
Split hero (title, tagline, 25-word value line, 2 CTAs | live demo) → stat strip
(1M cells / 60 fps / 15 kB / 10 lenses) → asymmetric bento (physics · snowflake image /
lenses · engineer-it) → footer (1 line + citation line, no dot chains).
