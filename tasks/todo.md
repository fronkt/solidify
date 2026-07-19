# SOLIDIFY — build plan & log

Full design: `~/.claude/plans/robust-puzzling-emerson.md` (flagship choice, UI/UX identity,
physics model, milestone gates — set in stone before implementation).

## Milestones

- [x] M0 — Vite+TS+WebGPU scaffold, ping-pong compute, gate screen
- [x] M1 — Single Kobayashi dendrite, canonical morphology (verified against '93 figures)
- [x] M2 — Multi-grain: grain-ID claiming, nucleation modes, chill wall, impingement
- [x] M3 — Visual identity: MELT / ORIENT / ETCH / FIELD views, relief lighting, film grain
- [x] M4 — Control rail, presets, HUD sparklines, GPU grain stats + ASTM readout
- [x] M5 — Tour: 6 chapters (Mullins–Sekerka → casting CET → optimizer)
- [x] M6 — "Engineer it": sep-CMA-ES over cooling schedule + nucleation, lab-notebook strip
- [x] M7 — README + hero shots, repo, deploy

## Review

**Verification done (2026-07-19, via Claude-in-Chrome screenshot loop):**
- Dendrite morphology matches Kobayashi: 4 primary arms, noise-gated side branches, tip glow.
- 6-fold switch produces dendritic snowflake.
- 60 rain grains: clean impingement, zero ID bleed, ASTM G 3.2 vs hand-sanity count.
- Optimizer: 27 castings, best |ΔG| 0.50 vs target G 4, thumbnails all real micrographs.
- 60 fps at 1024² on this machine; 2048² works with backpressure throttling.

**Bugs found & fixed during verification:**
1. Wide-stencil Laplacian → checkerboard instability + debris. Fix: compact 9-point Laplacian,
   divergence-form anisotropy via flux texture (the standard discretization).
2. Unbounded GPU submission queue froze the tab at 2048²+turbo. Fix: single submit per frame +
   `onSubmittedWorkDone` backpressure (skip stepping when ≥2 frames in flight) + per-grid substep cap.
3. Chrome suspends rAF in occluded windows — looked like a hang. Not a bug; documented; test hook
   `__solidify.tick(n)` drives frames synthetically.
4. CMA-ES `ask()` returned its internal population array; queue `shift()` emptied it → `tell`
   crash. Fix: copy.
5. Optimizer episode rain was wall-clock-paced (≈13 nuclei/casting, target unreachable). Fix:
   sim-time-paced rain, achievable target band G 1–6.
6. Stale stats poll could finish the *next* episode instantly. Fix: episode-tagged polls.

## v0.2 (2026-07-19, same day): landing + big feature expansion

- [x] Landing page at `/` (split hero, LIVE random-scene 256² demo, stat strip, bento,
      taste-skill audited — notes in `docs/landing-review-notes.md`, draft 1 archived); tool → `/app/`
- [x] State → rgba32float (φ, T, c, age): alloy solute channel + solidification-age channel
- [x] 6 new lenses (RINGS, THERM, SEM, NEON, XRAY, CURV) → 10 total
- [x] Alloy mode (WB-type dilute solute, qualitative): constitutional undercooling, halos,
      microsegregation; verified: dramatically different (solutal) morphology
- [x] Scenarios: Bridgman directional (pulled-gradient frame) + steerable/raster laser weld
- [x] Activation-undercooling nucleation (rain seeds gated by local T — inoculant potency)
- [x] Zoom (wheel) + pan (right-drag); scale bar zoom-aware
- [x] Pixel mode + 8-bit dithered palette (the retro look, on demand)
- [x] Pro panel (ε̄, γ, α, τ, k), brush size, seaweed preset (dense-branching morphology)
- [x] Transport: reset-arms-paused staging flow, run/pause/turbo (bottom-left), space bar
- [x] Challenge mode: player round vs CMA-ES at same target — verified full cycle to verdict
- [x] Tour → 9 chapters; `?tour=1` deep link

**v0.2 bugs found & fixed during verification:**
7. Landing single centered 4-fold crystal could scan as a swastika (user catch) — random
   scene generator never grows a lone 4-fold; singles are 6-fold or seaweed.
8. Bridgman demo pace too slow — pull 3.5, gradient 0.11, speed 40.
9. CURV/XRAY/halo gains too subtle — amplified.

## v0.3 (2026-07-19): materials + twinning

- [x] MATERIAL picker (9 qualitative identities): model metal, Al–Cu, Fe–C steel, Ni superalloy,
      Co alloy (freezes FCC → 4-fold, the teachable surprise), Mg AZ91 (6-fold metal), Zn spangle,
      ice, succinonitrile — each sets symmetry j, δ, latent K, alloy bundle, and melt incandescence
- [x] meltGlow in MELT lens: display-only blackbody scale — steel white-hot, Al dull red,
      Zn/ice silvery liquid with no glow (verified side by side)
- [x] Growth twinning: stochastic twin nucleation in the grain-claim pass (GPU atomic id
      allocator counting down from the top of the id range; θ₀ᵗʷⁱⁿ = θ₀ + π/j, the
      maximal-misorientation 2D analog of a coherent twin) + twin-rate slider (CRYSTAL)
- [x] Twin seed: Shift+click or "twin seed" button stamps a twinned pair — verified the
      12-branched snowflake (two 6-fold domains locked at 30°, grains = 2)
- [x] Twin boundaries etch faint in ETCH/ORIENT (misorientation ≈ π/j detected in render)
- [x] Tour chapter "The twin" (now 10); landing twinStar archetype + occasional twinned castings
- [x] Fair-play: twinProb zeroed in optimizer episodes + challenge player round

**v0.3 bugs found & fixed during verification:**
10. Twin spawn gate `best > 0.5` never fired — grain-id claiming runs ahead of the φ=0.5
    contour where neighbour φ ~ 1e-3, so no twins ever nucleated. Relaxed to a debris guard
    (`best > 0.003`); survivors then out-grow their parents exactly like real feathery grains.

## v0.4 (2026-07-19): alloy composer

- [x] `src/alloy.ts`: element database (6 bases × 3–6 solutes, approximate textbook
      dilute-limit m/k/D/mass per binary), dilute superposition ΔT_L = Σmᵢcᵢ,
      growth restriction Q = Σmᵢcᵢ(kᵢ−1), at% ↔ wt% conversion, pseudo-binary collapse
      (c₀ from total wt%, k_eff = 1 − Q/|ΔT_L| = mᵢcᵢ-weighted mean k, TSCALE 100 K/unit),
      honest clamp reporting; `#alloy=…` hash encode/decode
- [x] `src/composer.ts`: modal composer — base buttons, wt% sliders with live at%,
      element picker showing (m, k) + notes, famous-alloy quick-fills, derived readouts,
      auto alloy name, pour → material identity + pseudo-binary + armed melt + share hash
- [x] Copper base material added (10 materials now); deep link scatters seeds + runs
- [x] **Verified the money experiment**: same rain (12/s) + cooling, A356+TiB (Q 71 K)
      → 369 grains G 6.2 vs Al–1Zn (Q 0.9 K) → 46 grains G 2.8 — grain refinement from
      composition alone (Easton–StJohn growth restriction, emergent)
- [x] Chemistry spot-check: A356+TiB ΔT_L −44.7 K, Q 71.2 K match hand calculation;
      1045 deep link maps to c0 0.12 · m 0.80 (clamped) · k 0.24 · D 1.50 (fast C)

## v0.5 (2026-07-19): analysis instruments + tidy rail + science page

- [x] Collapsible rail: every section is a dropdown (▸/▾), open state persists in
      localStorage; only PRESETS + MELT·PROCESS open by default — decluttered
- [x] Mat line under the logo (top-left): always shows what's in the melt — material
      preset label or the composed alloy name (user request mid-build)
- [x] Cooling-curve probe: probe cell rides the stats reduction (Params +probeX/Y,
      144 B; Stats +probeT/probePhi), panel plots T(t) with liquidus line +
      "solid" arrest marker; ctrl-tap moves the probe; crosshair overlay via gridToClient
- [x] Scheil overlay: analytic T(fs) = 1 − m·c₀(1−fs)^(k−1) of the current pseudo-binary
      vs measured (fs, T_interface) — prediction and experiment in one chart
- [x] SDAS ruler: drag a line, one-shot GPU row readback (readLine), linear-intercept
      count with hysteresis → λ₂ (verified: λ₂ ≈ 45.7 µm over 7 arms on a big dendrite)
- [x] ⏺ rec in the transport: MediaRecorder canvas capture → .webm download (verified 1 MB/2 s)
- [x] Mobile: pinch-zoom + two-finger pan; touch taps seed on release so a second
      finger never leaves a stray crystal
- [x] /science/ page: model equations, why dendrites happen, twins, alloy chemistry + Q,
      numerics/GPU notes, quantitative-vs-qualitative table, references; linked from
      landing (CTA + footer) and the rail
- [x] Composer playability fix: dimensionless depression capped at 0.22 (badged),
      k floored 0.12, pour guarantees undercool ≥ 0.9 — heavy alloys (A356) no longer
      solutally choke a lone seed (fs 6.8 % vs 1 % in the same tick budget)

## v0.6 (2026-07-19): landing motion layer

- [x] anime.js v4 motion pass on the existing layout (Frank: motion layer now,
      scroll-story rebuild kept as backup; libraries free-choice — anime covers all needs,
      GSAP/Motion not pulled in; UIverse/shadcn contribute CSS craft, not packages)
- [x] Hero entrance: per-letter headline "solidifies" (rise + unblur + molten-amber→white
      cool-down), staggered copy/CTAs, demo panel scales in — timeline, outExpo
- [x] Scroll reveals via IntersectionObserver + anime tweens (once, never scrubbed):
      stat strip w/ count-up (1,048,576 rolls), bento stagger, footer
- [x] Micro-interactions: magnetic CTAs (spring return), primary-CTA sheen sweep,
      ghost/footer underline slides, bento cursor-tracking glow + lift, snowflake
      Ken Burns, pulsing LIVE dot, shadcn-style focus-visible rings
- [x] Robustness: inline html.anim gate skips prefers-reduced-motion, 2.5 s watchdog
      reveals page if module fails; transforms/opacity/filter only (no layout thrash
      against the WebGPU canvas); `:active` uses independent `scale` so it composes
      with anime's inline transform
- [x] Stat strip honesty: stale "15 kB" replaced with "0 FRAMEWORKS · HAND-ROLLED WGSL"
      (landing chunk is 18 kB gz with anime; instrument bundle unchanged)

## v0.7 (2026-07-19): scroll-story landing + sim-cast logo

- [x] **The logo is cast by the solver**: `resetMold` (mask → cold solid mold w/ age −1
      sentinel + superheated letter channels), `logotype.ts` rasterises the wordmark into
      the mold, seeds fire as the pour cools, fronts arrest at the mold walls; dedicated
      CAST render case (default) keeps frozen letters legible forever (lit steel + grain
      sheen + residual-heat ember vs near-black mold). Tap to re-pour. 768² hero grid.
- [x] Scroll story (GSAP + ScrollTrigger): pinned TEN-LENSES act (one live casting,
      scroll flips all 10 lenses + rail), pinned MATERIALS act (4 steps re-pour
      steel/Al/Zn/ice with true melt glow), composer teaser (chips, Q count-up,
      369-vs-46 bars), science finale (equation types itself, stamps, big CTA)
- [x] All acts are LIVE sims sharing one GPU device, visibility-paused via
      IntersectionObserver: only the act on screen ticks
- [x] Fallbacks: no-WebGPU / reduced-motion → static text + stills, no pins;
      html.anim watchdog kept; topnav appears past the hero (align-items fix per Frank)
- [x] Archived v0.6 landing → docs/landing-v0.6-archive-2026-07-19.html
- [x] Bugs fixed during verification: logo band vertically mirrored (renderer UV already
      flips; removed double flip); frozen letters went mold-dark (wall epitaxy claims
      mold's grain id → switched mold identity to the age channel); IO active-flags are
      stale immediately after programmatic scroll in occluded windows (test-harness only)

## v0.8 (2026-07-19): molten crucible logo + polish round (Frank's live feedback)

- [x] Crucible scenario (scen 3): non-mold cells relax toward a heater set-point
      (holdT/holdRate in the spare Params slots), mold stays a cold sink, pointer =
      torch (weld gaussian in the same branch). Arc: white pour flash → held orange
      gloop (~13 s, mushy near-liquidus + molten pockets) → heater dies over 17 s
      (holdT ramps 0.985→0.18, grains rain in) → cold grained metal (~9 s) → re-pour
- [x] Cursor torch: white-hot wake + molten runnels, remelts hardened regions, they
      refreeze when you leave; grain rain runs in molten+harden so the gloop is
      polycrystalline and the hardened word shows grain contrast
- [x] CAST lens: piecewise-compressed blackbody (only superheat flashes white; the
      held melt reads orange; dying heat walks red)
- [x] **Root-caused a silent showstopper: `target` is a WGSL reserved keyword** — the
      whole crucible branch invalidated UPDATE_WGSL and Chrome surfaced nothing; every
      "phase" screenshot was the static initial state. Found via pushErrorScope +
      getCompilationInfo (probe cell read T=1.250 pristine after 470 frames)
- [x] Lens act: substeps 10→7 + coolRate 0.08 (≈5 s more dendrite stage time)
- [x] Hero copy: wordmark paragraph removed, CTAs moved up; SCROLL cue given real
      clearance; amber ::selection; themed scrollbar (black track / amber thumb);
      SI favicon (S amber, I neutral) on all three pages; topnav align-items fix

## v0.8.1 (2026-07-19): gentle cursor + dendritic fringe (Frank's feedback)

- [x] Cursor detuned from plasma torch to gentle gloop: weldPow 150→0.25 (equilibrium
      ΔT ≈ +0.06 vs +37), σ 12 — softens the mush locally, relaxes back over ~3 s
- [x] Dendritic fringe: logotype mask gains a rim zone (stroked-glyph dilation, age
      sentinel −0.25) of cold undercooled liquid held at 0.72 — dendrites sprout from
      the letter edges into it and arrest at the mold, so the type gets organic
      melted-wax boundaries + molten orange cores in a pale crust instead of
      laser-cut glyphs
- [x] SCROLL cue lowered again (hero padding-bottom 62px, cue at 2px)
- [x] v0.8.2: dendritic rim REMOVED (Frank: read as fatter letters) — back to
      glyph-width molds; gentle cursor + arc unchanged

## v0.9 (2026-07-19): stains + texture (Frank's ask)

- [x] Grain stain select in LOOK (applies to ETCH): plain Nital / Klemm's tint
      (straw browns↔steel blues) / Beraha's tint (blue-violet) / anodize + crossed
      polars (vivid hue wheel) — orientation-keyed interference colours, RParams
      lookFlags low bits
- [x] EBSD flat map checkbox (applies to ORIENT): flat IPF hue wheel, no relief,
      black boundaries (twin boundaries lighter) — lookFlags bit 8
- [x] Texture rose in ANALYZE: area-weighted grain-orientation histogram over the
      fundamental zone, replicated by the crystal's j-fold symmetry; θ₀ snapshot
      rides the stats staging readback so GPU-spawned twins are counted
- [x] Verified: Klemm's on an equiaxed casting reads like a real tint etch; EBSD map
      unmistakable; rose live (random texture from 24 random seeds); Bridgman
      columnar-selection texture left as an emergent thing to explore

**Known limits / next:**
- [ ] Grain-boundary lines in ETCH are thin/broken while liquid films persist (partly physical)
- [ ] Alloy solute scheme is qualitative (labelled as such); quantitative WB is a bigger lift
- [ ] Optimizer/challenge use fixed 256² episodes; could expose episode budget
- [ ] WebGPU only — gate screen with explainer for unsupported browsers (recorded loop TBD)
