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

## v0.9.1 (2026-07-19): tour part II — the instrument

- [x] Tour extended 10 → 22 chapters: PART II walks every control — transport+lenses,
      PRESETS, MATERIAL, MELT·PROCESS, SCENARIO, ALLOY(+composer), CRYSTAL, ANALYZE,
      LOOK (stains/EBSD), ENGINE/ADVANCED/MODES, canvas gestures
- [x] Non-destructive: part II never touches the running melt; chapters carry `hl`
      targets — "sec:TITLE" opens+scrolls+pulses a rail section (ui.reveal), CSS
      selectors highlight fixed chrome (#transport, #views); reveals cleared on
      step change and close; Chapter.apply now optional, counter shows part label

## v0.9.2 (2026-07-19): contact page

- [x] /contact/: email card (address assembled in JS at click-time — never in the
      HTML for scrapers; verified), GitHub-issue card w/ bug-report guidance
      (lens/material/scenario + browser/GPU), copy-address button, house style,
      linked from landing topnav+footer, science footer, app rail
- [x] Analytics: GoatCounter live on all four pages (code frankcai2 →
      dashboard frankcai2.goatcounter.com); cookie-free, no consent banner

## v1.0 (2026-07-19): Vercel migration + text logo + SEM blueprint

- [x] Migrated to Vercel: prod at solidify-mu.vercel.app (CLI deploys; the old MCP-token
      403 was token-only). gh-pages replaced with JS redirect stubs that preserve
      path/query/hash (+404.html). `vercel git connect` blocked until Frank adds a
      GitHub Login Connection in Vercel account settings.
- [x] Crucible logo removed (Frank: revert) — clean text wordmark returns with the
      v0.6 letter-solidify entrance (rise + unblur + amber→white); logotype.ts deleted;
      solver keeps resetMold/scen-3/CAST as unused engine capabilities
- [x] NEW: "From beam to grain" SEM blueprint act (Exa-style) — patent-drawing SVG of
      an electron-microscope column in amber line work; pinned scrub draws every stroke,
      labels fade in, the beam dot descends to the dendrite sample, and the signal wire
      hands off into the TEN LENSES act; fully-drawn static fallback for nogpu/reduced
- [x] Fixed: hero CTAs invisible since v0.7 (container never animated, only its
      anchors — pre-state kept .cta at opacity 0); fixed: initSemAct threw on the
      <g> sample (no getTotalLength) which silently killed the whole boot
- [ ] frankcai.dev purchase: WAITING on registrant contact (street/city/state/zip/phone);
      then attach solidify.frankcai.dev + apex redirect, re-point gh-pages stubs,
      update README links

## v1.1 (2026-07-19): THE DIVE (Exea-style scroll descent)

- [x] SEM scrub act replaced (Frank: below expectations, wants exealabs.org-style
      camera descent). Studied the reference live: pinned wireframe scene, camera
      dives through 5 scales, FIELD ≈ readout + stage counter + dash rail + callouts
- [x] src/dive.ts: 2.5D piecewise camera — log-space zoom through stage chain
      (k = 8·10·8·8·2 ≈ 10240× total, rebased per stage so CSS scales stay ≤10),
      camera zooms toward each stage's dashed RETICLE while panning it to center,
      next stage crossfades in exactly inside the reticle (cover-fit content→screen
      mapping keeps anchors exact at any viewport)
- [x] Ladder (Frank's note: "GPU card to package then to a microscope"): YOUR GPU
      (iso card) → THE DIE (floorplan, "1,048,576 CELLS LIVE HERE") → THE MICROSCOPE
      (column art returns as one stage) → THE SPECIMEN (grains + dendrite target) →
      THE DENDRITE · LIVE (real 256² sim crossfades in, "not a video")
- [x] HUD: SCROLL TO GO INSIDE, per-stage title+sub, FIELD 300 MM→50 µM, 0i/05,
      dash rail; stage art = stroke-only SVGs, hand-drawn replacements spec'd in
      docs/dive-art-spec.md (Frank will redraw; reticle aspect 3:2, data-k = 1200/rectW)
- [x] Verified all five stages live incl. the sim finale; reduced-motion/nogpu get
      static stage 1 + fallback still

**Known limits / next:**
- [ ] Grain-boundary lines in ETCH are thin/broken while liquid films persist (partly physical)
- [ ] Alloy solute scheme is qualitative (labelled as such); quantitative WB is a bigger lift
- [ ] Optimizer/challenge use fixed 256² episodes; could expose episode budget
- [ ] WebGPU only — gate screen with explainer for unsupported browsers (recorded loop TBD)

## v1.2 (2026-07-19): THE DIVE goes true 3D (Three.js wireframe world)

Frank: "still far behind exea labs quality... dynamic, turns, is in 3D space and
moves; the gpu fans also move around... make the microscope 3D and have it zoom
into different parts like animejs.com breaks apart its camera lens... make the
dendritic growth a geometric vector svg."
Research finding (decompiled exealabs.org bundles): their hero = Three.js
LineSegments wireframes + procedural geometry builder (seg/poly/circle/box) +
scroll-keyframed camera + idle sway (0.008·cos(t/6600)) + DOM labels projected
via .project(camera) + particles lerping along paths; SSR SVG is only the
reduced-motion poster. animejs.com also ships Three.js.
Frank's design calls (AskUserQuestion): SEM column for stage 3; ALL five stages
3D; geometric dendrite REPLACES the live-sim finale (diveSim removed).

- [x] deps: three (ships own types), d3-delaunay (+@types) for specimen grains
- [x] src/dendrite.mjs: seeded 6-fold geometric dendrite generator (primaries +
      enveloped secondaries + tertiary stubs, birth-time per segment) shared by
      runtime (growth = drawRange) and poster script
- [x] src/dive3d.ts (lazy chunk): Wire builder (LineSegments per class w/d/amber/
      beam, fog, transparent canvas), five stage groups, per-stage camera
      keyframes + crossfade handoff, DOM label/reticle projection layer, fan spin
      + scroll-velocity boost, particles (heat wisps, interposer clock pulses),
      idle sway + pointer parallax, IO-gated rAF, WebGL-fail → old SVG dive
- [x] S3 SEM column: gun/anode/condenser×2/scan coils/objective/aperture/chamber+
      specimen puck parts explode axially with stagger + labeled callouts, amber
      beam draws through the bore, camera descends past parts then dives to puck
- [x] S5 finale: growing geometric dendrite (draw-on under scroll) + ENTER THE
      LAB CTA; HUD copy updated (no more "not a video" line); diveSim deleted
      from landing.ts; poster SVG generated into stage 5 fallback
- [x] index.html: canvas#dive3d + #diveLabels + #diveReticle, live3d class hides
      SVG stages when 3D active; scroll length +=6800, stage weights 1/1/1.7/1/1.4
- [x] verify: scrub screenshots at 9 progress points in fresh tab, fan-motion
      diff, FPS probe, WebGL-kill fallback, reduced-motion, 390px viewport,
      tsc + build size; deploy Vercel prod; push

All verified 2026-07-19 headless (extension pipeline was wedged): live3d boot,
9-point scrub, fan-motion frame diff, 52 fps on SwiftShader (software!), WebGL-kill
→ SVG dive, reduced-motion → static, 390px OK; deployed + pushed (8569319).
LESSON: per-endpoint jitter on shared polyline nodes reads as DASHES — lift each
node once and share it between adjoining segments.

## v1.3 (2026-07-19): the 11-stage instrument ladder (Frank: "detail the tools we use")

- [x] AskUserQuestion round: all four instruments (synchrotron/press/saw/polisher),
      FULL stage each, synchrotron before the lattice finale
- [x] Ladder: GPU 300mm (die-lid REVEAL: hinges open to interposer+chiplets) →
      DIE 40mm → CORES 10mm (SM floorplan, amber solver core, L2 pulses) →
      SAW 400mm (spinning disc, cast ingot, ballistic sparks, amber slice) →
      PRESS 200mm (mold sleeve lifts, amber puck revealed, gauge+heater band) →
      POLISHER 150mm (spinning platen + counter-rotating holder) →
      MICROSCOPE 5mm (slow Y-spin + stigmator/BSE/feedthrough/porthole/turbo/conduit) →
      SPECIMEN 500µm (+ spring clips, Vickers indent) → DENDRITE 50µm (tip halos,
      dives into its nucleus) → LIGHT SOURCE 200m (ring, 12 magnets, RF, undulator,
      bunches racing, beam pulse to hutch sample) → LATTICE 1nm (HCP triple-ring
      atoms, amber unit cell, draw-on, CTA)
- [x] scrub end +=16600, weights per stage, HUD 0X/11 + dynamic dash rail
- [x] verified headlessly at 18 scroll points; bugs fixed: cores reticle 1.2 units
      off the amber SM, press/polisher too-tight cameras, lattice atoms drawn as
      "pins" (vertical ring mis-centered), stray label statement

## v1.4 (2026-07-20): 16 stages — the full toolchain + ALL IN ONE finale

- [x] Frank: add furnace/tensile/arc/Vickers/atom-probe ideas, saw OUT, beamline
      clarified (endstation ≠ microscope: electrons image shape, X-rays measure
      spacing), finale = "ALL IN ONE" (SOLIDIFY as the instrument)
- [x] New stages: FURNACE (coil crucible, amber pour drawn on, casting fades in,
      heat shimmer) → ARC MELTER (per-frame jagged arc + flicker, hearth buttons)
      → VICKERS (spindle descends/dwells/retracts, indent fades in, continuity
      with specimen's indent) → TENSILE (crosshead pulls, dogbone snaps at jagged
      amber fracture, extensometer drops off) → BEAMLINE (hutch room + slits/
      mono/goniometer rocking/detector with Debye rings drawing on) →
      ALL IN ONE (browser-window instrument + 10-machine orbiting carousel,
      "FIELD = ONE TAB", CTA)
- [x] Ladder: GPU→DIE→CORES→FURNACE→ARC→PRESS→POLISHER→VICKERS→SEM→SPECIMEN→
      DENDRITE→TENSILE→RING→BEAMLINE→LATTICE→ALL IN ONE; end +=23000; 0X/16
- [x] fixes: beamline goniometer 0-seam cylinder read as floating rings; hutch
      walls added (stage was too sparse); atom-probe idea PARKED (17 stages felt
      like enough; revisit if Frank asks)
