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

## v1.5 (2026-07-20): pruned to 13 + bespoke transitions on every handoff

- [x] Removed furnace/press/Vickers per Frank (builders deleted, git keeps them);
      ALL IN ONE camera settles dead-on at az=π/2 (window faces +z); end +=19000
- [x] AskUserQuestion: ALL twelve handoffs bespoke, pivots KEEP the dissolve
      (no iris), mixed exit/arrival energy
- [x] Transition events: die lid (existing) · DIE→CORES amber scanline sweep +
      rows light (drawRange) · ARC→POLISHER button lifts from hearth (arc dies,
      reticle tracks via new dynamic target fn) · POLISHER→SEM puck tilts
      face-on + sheen sweep · SEM→SPECIMEN chamber riser Z-approach ·
      SPECIMEN→DENDRITE root star sprouts tease branches · DENDRITE dives into
      nucleus · TENSILE arrival: crosshead descends + grips clamp before pull ·
      RING arrival: 12 magnets pop in sequence (per-magnet mats) · RING→BEAMLINE
      camera enters through hutch door, door slides shut, beam-on lamp lights ·
      BEAMLINE→LATTICE Debye rings scale up past camera (rings on own centered
      group) · LATTICE→ALL-IN-ONE crystal collapses to a pixel, screen dendrite
      grows from it on arrival
- [x] StageDef.target now P3 | ()=>Vector3 for moving dive targets
- [x] verified 11 scroll points headless; 60 fps (one 5.4 reading was SwiftShader
      still settling after screenshot churn — re-probe twice before believing)

## v1.6 (2026-07-20): "Engineer it" → paused ENGINEERING ML MODE + tour explainer

- [x] Frank: don't auto-start the optimizer on click; enter a mode with a small
      explanation, and make the transport pause/run actually gate it
- [x] Optimizer: `running` state; free-play start() enters PAUSED (challenge AI
      with a casting limit still auto-runs); setRunning()/isRunning(); tick()
      gates on running; panel retitled "⚙ ENGINEERING · ML MODE" + explainer line
      + moved status below strip; "stop"→"exit"
- [x] main.ts: setRun()/isRunning() route to opt when opt.active; paused frame
      still renders (ORIENT) so the stage isn't frozen; isEngineering() added
- [x] ui.ts: engineer-it button syncs; armed/PAUSED indicator suppressed in ML
      mode (panel shows its own status)
- [x] tour "Engineer it" chapter rewritten to explain the mode, the run/pause,
      and WHY early castings look like a chaotic blizzard of grains (exploration;
      grain count = nucleation knob; finer target = more grains)
- [x] BUG fixed: setRunning() bailed on `this.finishing` → pause was dropped
      during the async stats read; now pause always lands, in-flight casting
      completes then loop halts. verify-optimizer.mjs asserts enter-paused/run/
      pause-frozen/exit end-to-end

## v1.7 (2026-07-20): recipe report + forbidden symmetry

- [x] Optimizer payoff (Frank: "it just keeps going with no report"): free-play
      convergence detection (best |ΔG| ≤ 0.3 + 6-casting stall after ≥12, or
      18-casting hard stall) → pauses on an amber REPORT: best G, castings used,
      and the recipe (undercooling · nucleation/unit-time · cooling early/mid/
      late) with ⚗ APPLY RECIPE (exits, stages it ARMED on the full grid — incl.
      fracSolid-scheduled cooling in the main loop + sim-time→wall rain
      conversion) and KEEP SEARCHING; target-slider move re-arms the watch;
      challenge path (limit>0) unchanged. verify-optimizer runs the whole arc:
      converged #17, |ΔG| 0.15, applied → 1024², armed.
- [x] Crystal symmetry (Frank: "all 7 systems/14 lattices? quasicrystals?"):
      honest 2D answer implemented — CRYSTAL now offers ×2/×3/×4/×6 (the only
      rotations a periodic lattice allows in 2D — restriction theorem) plus
      forbidden ×5/×10 quasi modes; shader was already generic in j. New
      Al–Co–Ni decagonal MATERIAL (j=10, δ=0.022 — exceeds δ_crit=1/(j²−1) but
      regularizes fine, verified), "quasi" preset (j=5 star, verified), tour
      chapter "Forbidden symmetry" (Shechtman story + honesty note: interface-
      energy symmetry only, not the aperiodic lattice). 14 Bravais lattices are
      3D classifications — out of scope for a 2D section, said so honestly.

## v1.8 (2026-07-20): the tool batch — facets, share links, enlarge, tilt

- [x] FACETED GROWTH: Params +facet (buffer 144→160B, f[36]); FLUX pass gets a
      regularized-cusp interface energy ε=ε̄(1+δ(2√(sin²(β/2)+.001)−1)) — cusped
      minima pin j flat facets; CRYSTAL checkbox; NO_SCEN clears it; verified:
      j=6 grows a genuinely flat-faceted hexagonal crystal (vs smooth dendrite)
- [x] SHARE LINKS: src/share.ts #set= base64url of {params−(dx/dt/weld/tFar),
      undercool, lens, material, name, rain, recipe schedule}; boot applies
      ARMED; ADVANCED "⎘ copy setup link"; optimizer report "⎘ copy recipe link"
      (shareRecipeLink builds without applying). Round-trip verified field-exact.
- [x] PANEL ENLARGE (Frank: popups need an enlarge for examination): all three
      analyze panels get ⤢ → live modal viewer (draw fns refactored to take ctx,
      fonts scale via frame().fs); big rose verified live at 920px
- [x] SPECIMEN TILT (Frank asked "3D as a checkbox?"): honest answer = true 3D
      is a rewrite (grid³ + volume rendering), NOT a checkbox; shipped instead
      LOOK "specimen tilt (2.5D relief)" — lookFlags bit 512, oblique
      foreshorten + age-height parallax + raking-light normal shading over any
      lens; labeled 2.5D, verified reads as raised specimen
- [x] PARKED with reasons: polymorph switching (needs solid-state transformation
      physics — new nucleation-in-solid pass), Penrose overlay (decoration; the
      honest QC payoff would be a future FFT "diffraction" instrument)

## v1.8.1 (2026-07-20): enlarge-click fix + activation switch + 3D verdict

- [x] BUG (Frank): #apanels has pointer-events:none so the ⤢ button click fell
      through to the canvas and SEEDED. Fix: .apanel pointer-events:auto —
      panels interactive, strip still passes through. Verified with real mouse.
- [x] Tilt rebuilt as an ACTIVATION SWITCH (.actswitch: pill track + amber-glow
      knob + "RENDER MODE" tag) per Frank's Illustrator analogy; note says
      "true 3D: planned"
- [x] 3D FEASIBILITY PROBE on the live device: maxTextureDimension3D=2048,
      268MB buffers, 128³ rgba32float texture_storage_3d CREATED and a 3D
      compute pipeline COMPILED. Verdict: true 3D at 128³–192³ is genuinely
      buildable as an activation-switch mode (Kobayashi 3D cubic-harmonic
      anisotropy + raymarched isosurface renderer) — its own build session,
      NOT this one. Plan when Frank calls it.

## v1.9 (2026-07-20): TRUE 3D MODE — volumetric phase-field + raymarcher + ViewCube

Design: ~/.claude/plans/robust-puzzling-emerson.md (overwritten with the 3D plan).

- [x] M0 — PALETTE_WGSL extracted from RENDER_WGSL (hashf/heat/inferno/polar/
      hue2rgb shared with 3D); float32-filterable requested at device creation;
      caps3d limit gate. 2D suite still green.
- [x] M1 — sim3d.ts + shaders3d.ts: rg32float (φ,T) n³ ping-pong, r32uint grain,
      rgba32float flux; FLUX3D/UPDATE3D/STAMP3D/STATS3D @wg(4,4,4); variational
      anisotropy split A = ε²a|∇φ|(g−(g·n)n), w = ε²a²; cubic ⟨100⟩ + hex-K6
      basal plates via per-grain quaternions (Marsaglia); 6-face claiming;
      dt 9e-5; OOM ladder 192→160→128 (pushErrorScope).
- [x] M2 — render3d.ts: fullscreen-triangle raymarch (coarse 2vox → fine 0.7 →
      3× bisection, central-diff normals, hardware trilinear when filterable);
      z-up orbit camera w/ eased az/el/dist/target, idle auto-orbit @8s;
      TRUE 3D actswitch BELOW the controls button (slides with rail).
- [x] M2.5 — viewcube.ts: CAD ViewCube (Canvas2D, labeled faces, painter-sorted,
      exact 2×2 unprojection hit-test; face/edge/corner → snapped views incl.
      isometric; drag-to-orbit with hand-matched direction per Frank's report).
- [x] M3 — SLICE (fixed +side clip, cut-face micrograph w/ in-plane GB detect,
      ghosted isosurface behind) + FIELD x-ray transmittance; slice axis/depth
      rail controls + shift-drag scrub; tap-at-depth seeding (ray ∩ slice plane
      or view-facing mid-plane).
- [x] M4 — rain nucleation in volume, impingement, StatsResult3D (fracSolid /
      grainCount / eq-diam µm at the 2D-consistent 0.977µm voxel), 3D readouts,
      chrome gating (body.mode3d), 4-lens row swap, rail section gating.
- [x] M5 — materials to3D() mapping (cubic/hex; qc = "2D only" w/ fallback),
      share links carry {d:1, g3}, 128³/160³/192³ grid buttons + OOM ladder.
- [x] M6 tuning — per-pixel ray-start jitter (killed contour banding), fine-march
      window 14vox (interface is ~6vox wide — grazing rays missed crossings),
      smooth-T sampling for surface ember + emission (killed T-quantization
      wood-grain), home dist 3.1 frames the box, dt clamp ≥0 (tick() harness).
- [x] Verified (scripts/verify-3d.mjs, real headless WebGPU): 192³ + filterable,
      fracSolid monotone growth, two-seed → 2 grains distinct hues, 4 lens shots,
      real-mouse orbit, tap lands on plane, ViewCube TOP snap el→1.45,
      60 fps @ 192³ AND 128³, share round-trip, zero page errors. 2D suite green.
- [x] MORPHOLOGY: center seed grows the textbook cubic sequence — ⟨100⟩-vertex
      octahedron with hopper faces → 4/6-arm cross with glowing latent-heat
      halo pockets (MELT lens is the money shot).

**Bugs found & fixed:**
1. WGSL forbids mixing `*` and `^` without parens — UPDATE3D never compiled,
   every step silently dropped (validation errors only visible as console
   warnings). Lesson: getCompilationInfo / console-warning capture in tests.
2. layout:"auto" DROPS bindings the shader never statically uses — quats at
   render binding 3 made every bind group invalid → black canvas. Fix: ORIENT
   hue now derives from the actual quaternion axis (better science anyway).
3. ViewCube drag felt inverted horizontally (Frank): grabbing the cube must
   spin the cube with the hand = orbit the camera the OPPOSITE way; dy stays.

## v2.0 (2026-07-20): THE 3D CHARACTERIZATION LAB — deployed

Design: ~/.claude/plans/robust-puzzling-emerson.md (v1.9 plan archived alongside).
Identity: cast → solidify → inspect (x-ray NDT, SEM, sectioning, EBSD, stereology)
→ take it home (STL, turntable). All milestones committed separately; prod-verified.

- [x] N0 — ViewCube Fusion hover zones: face/edge/corner cells highlight on every
      visible face (thresholds ±0.55), `__solidify.vc` hook.
- [x] N1 — Free section plane {axis, depth, tilt 0–90°, turn 0–360°} → n̂+c;
      R3 144 B; floating SECTION PLANE popup (slicepanel.ts) w/ CT sweep;
      cut styles Nital/Klemm's/Beraha's/EBSD-IPF; share `sl`; rail panel killed.
- [x] N2 — ageTex rg32float (freeze time + Niyama-at-freeze); 5 new lenses →
      9 total (SEM fractograph, RINGS growth shells, THERM ironbow emission,
      NEON volumetric dark-field, CURV); keys 1–9.
- [x] N3 — Shrinkage porosity: generation-stamped feed flood from the riser
      (top-face liquid; gen advances per 2n substeps — physics-time, not frames),
      solidify-while-unfed pore rule (PORE_ID=4095, φ pinned, anneal never heals),
      Niyama Ṫ from lapT−coolRate+heatIn (recalescence-clean); FIELD x-ray dark
      specks; SLICE void + Niyama ramp style; porosity % readout. Deterministic
      hollow-shell test: 0.57% poreFrac vs 0 in pPore=0 control.
- [x] N4 — analyze3d.ts: STEREOLOGY panel (section d̄₂/ASTM-from-plane vs true
      3D census d̄₃ — measured ratio 0.91, Saltykov note) + IPF texture scatter
      (CPU quats, stereographic, point ∝ vox^⅓) in #apanels3 with ⤢ modals.
- [x] N5 — STL export: readPhiVolume (COPY_SRC) → surface-nets worker
      (mc-worker.ts, watertight via virtual φ=0 pad, exact 84+50·tris bytes);
      360° turntable (spinTo 2π/6s + auto rec-stop); 3D HUD mode (porosity
      strip + eq-diam histogram).
- [x] N6 — Σ3 twin shift-tap (60° about lab ⟨111⟩ of q₁ — verified 60.00°
      misorientation), chill wall→chill floor in 3D (8×8 at z=2, opposite the
      riser), hex-only habit slider (δz: −needles ⇠ ⇢ plates+).
- [x] N7 — Tour part III "THE THIRD DIMENSION" (out of the plane / orbit it /
      section it / inspect it / take it home); Chapter.dim + goto() awaits the
      mode switch BEFORE staging; manual dim-switch closes the tour (closeTour);
      mode-aware clearMelt/scatterSeeds/setParams/setSpeed; graceful no-WebGPU
      fallback card; tour button in 3D opens straight onto part III.
- [x] N8 — Landing: LIVE #threeDAct (96³ Sim3D on the landing device, dynamic
      import, warm-melt recipe so arms actually form, scroll-gated, no3d
      fallback still); hero stat "7,077,888 voxels"; science §6 THE THIRD
      DIMENSION (+Karma–Rappel, Niyama refs; honesty row updated); README
      TRUE-3D block + hero-3d.jpg; contact "2D or TRUE 3D"; capture-demos
      3D block; 96 rung in the OOM ladder; verify-3d +6 v2.0 regressions
      (NINE-LENSES / SLICE-TAP / CAST-SMOKE / STEREOLOGY / STL / VC-ZONES).

**Verified:** full verify-tools + extended verify-3d green (60 fps @192³ AND
128³), landing suite green on dev + prod bundle, production smoke on
solidify.frankcai.dev green (landing live-D3 grows, tour 24/28, science §6,
STL in prod bundle). Zero page errors anywhere.

**Bugs found & fixed (v2.0):**
1. Porosity gen counter was frame-paced → turbo starved the flood; now
   substep-paced with feedIters scaled to steps.
2. Thin-remnant pore rule never fired (channels stay fed to the end) →
   replaced with solidify-while-unfed micro-porosity (better physics too).
3. TDZ boot crash: UI queried an3 before construction — order analyze→an3→ui.
4. STL read back zeros — storage textures need explicit COPY_SRC.
5. RINGS moiré — bands normalized to total growth time (misc.x).
6. Headless canary: WebGPU canvas presents only on real BeginFrames — assert
   solver state (fracSolid), not pixel diffs, for liveness in headless tests.
7. Landing demo first recipe grew a featureless blob: fully-cold melt is
   kinetic-limited massive growth; warm melt (undercool ~0.7–0.85) is
   diffusion-limited and grows the six-armed star. Same lesson drives the
   capture recipe (128³, undercool 0.7, ~4000 frames @ speed 22).
8. SLICE cut-face smear (Frank's field report, v2.0.1): with the camera in the
   removed half, rays that cross the INFINITE plane outside the box and then
   enter the kept half through a box face still set cutFront — sliceColor then
   sampled an out-of-box point, clamp-to-border sampling smeared the micrograph
   across the bottom/top/side faces. Fix: cutFront only when tp >= hit.x (the
   crossing lies inside the volume). Lesson: in a clamped-sampling raymarcher,
   gate every analytic sample point (planes, sections) to the box interval —
   clamping silently invents plausible-looking data outside it.

## v3.0 (2026-07-21): THE FULL INSTRUMENT IN THE VOLUME — deployed

Design: ~/.claude/plans/robust-puzzling-emerson.md (v2.0 plan archived to
-archive-2026-07-21-charlab-v20.md). Frank: "add everything from 2D to 3D plus
additional 3D specialties" + kill idle auto-orbit + fix the rough bottom.
Scope via AskUserQuestion: lazy full-grid alloy · Bridgman/weld/grain-selector ·
facets/twins/icosa/retro (all four) · probe+Scheil/pole/SDAS (no shaped molds,
no 3D optimizer). Pre-arc fixes shipped same session: idle auto-orbit removed,
box-face speckle (entry-snap + face-normal fallback), SLICE plane smear.

- [x] V0 — Params3D 128→192 B (scen/bridgman/weld/alloy/twin/facet/probe slots),
      STATS3D interf/interfT + probe single-writer in the reserved header pads.
- [x] V1 — Bridgman 3D (pulled z-isotherm, mode-ranged gradient dial 0.05–0.9 —
      the 3D domain is 5.3× shorter in physical units) + weld 3D (top-face
      laser, Beer–Lambert depth, serpentine raster, tap-to-steer). Verified:
      front climbs bottom-first w/ exactly the 64 chill grains; probe-local
      melt/refreeze cycle 1.00→0.00→1.00.
- [x] V2 — alloy end-to-end: lazy r32float solute pair (+57 MB only while on,
      runtime error scope — the create ladder doesn't cover runtime allocs),
      WB port in a SECOND UPDATE3D template variant (4 storage textures,
      device-limit gated ≥4; never dummy-bind storage), stamp-flip solute copy,
      renderer 1×1×1 dummy + rebindBGs split (rebind3 resets the camera!),
      FIELD/MELT/SLICE solute rendering, composer routes 3D, swap re-allocates.
      Emergent: solutal growth restriction (fs 8× slower, same staging).
- [x] V3 — GPU growth twins in the claim pass (Σ3 60° about parent ⟨111⟩,
      atomicSub from 4094 — pre-decrement! — guard idFloor<tid<PORE, quats
      become read_write, quatBuf +COPY_SRC + stats-cadence readback) + faceted
      growth (regularized Σ√(nᵢ²+ε) — {100} cusp minima). Twin gate retuned
      0.003→0.0002 (the 3D claim wave re-claims at deeper tails than 2D).
      Verified: misorientations QUANTIZED on the Σ3-cascade set {0, 31.6, 54.5,
      60…} — random junk would spread continuously.
- [x] V4 — icosahedral QC (aniMode3 3): six 5-fold axes, a = 1+δ(7Σ(n·m)⁶−6),
      δ clamped 0.035 (convexity edge ≈0.029, soak-tested); ternary sym row
      (×4/×6/icosa), Al–Co–Ni maps supported. Grows a 12-lobed star.
- [x] V5 — grain selector (scen 3): always-allocated r8uint mask (7 MB kills a
      class of rebind bugs), lazy pigtail raster (helix r 0.16n, channel r
      0.055n, 1.75 turns, z 0.12–0.45n), wall early-out FIRST in UPDATE (φ
      pinned, cold, never claimed), glass-ghost + x-ray render, runs under the
      scen-1 pull, pPore 0 (FEED would flood through φ=0 walls). VERIFIED THE
      STORY: 64 floor grains → grain #45 alone in the spiral → alone in the
      blade. + fixed a REAL v2.0 race: readStereo shared paramBuf with step()
      — a concurrent writeParams zeroed the plane → full-box census; stereo
      now owns its uniform buffer.
- [x] V6 — instruments: probe3 (ctrl-tap voxel, worldToClient crosshair on the
      shared overlay — append-only, never innerHTML), Scheil vs measured
      interfaceT, stereographic pole figure (⟨100⟩/c-axis/5-fold by mode),
      ANALYZE section dispatches per mode, scale bar serves SLICE at the
      camera-target distance.
- [x] V7 — SDAS ruler: LINE3D pass (400 φ samples, OWN 32 B uniform — endpoints
      don't fit P3, and shared buffers are how the stereo race happened),
      2D hysteresis+λ₂ verbatim, armed drag pre-empts orbit.
- [x] V8 — retro voxel + 8-bit palette (flags bits 0/1; cut styles own 4–7),
      3D share links pack sim3d.params (packing sim.params was a BUG — scen/
      alloy/twins never travelled; restore lands dials after apply3DMaterial,
      allocates solute), all nine presets staged 3D + selector preset,
      double-tap seed guard.
- [x] V9 — science §6 grows the full-instrument story + honesty rows (selector
      geometric, icosa interface-energy-only, Ny uncalibrated in scen 1/2),
      README v3.0 block, tour finale names the selector, verify-3d → 23 checks.

**Verified:** 23-check 3D suite + 2D tools suite green through every milestone;
prod smoke after deploy. Harness lessons: tick-bursts deliver ~1/20 of wall-clock
physics (busy-guard skips) — quench hard instead of waiting out cooling; seed
with the identity quaternion when a test needs an arm to hit a known point;
never round-trip UTF-8 through PS5.1 Get/Set-Content (µ → Âµ).

## v4.0 — REAL PHYSICS: EMERGENT NUCLEATION + THE LAB (2026-07-21)

Prompted by a PhD reviewer's critique: the sim exposed undercooling, cooling rate AND a
"nucleation /s" slider as three independent knobs, but nucleation rate is a *dependent*
quantity — a consequence of the other two through recalescence. He also asked for a
realism-first mode (set the environment, then watch), and Frank asked for turbo → 2×/4×.

- [x] **L0** — `turbo` → a ×1/×2/×4 multiplier on the speed slider (`SPEED_MULTS`).
      `sim.step(substeps * speedMult)`; the fence cap already bounds the product.
- [x] **L1** — both stats passes reduce **meanLiquidT** (free header slots; stride-2 sampling
      + ×500 fixed point keeps the sum inside u32 at 2048²/192³). Mould cells excluded.
- [x] **L2** — STAMP seed slot 4/5 becomes activation **UNDERCOOLING** measured against the
      LOCAL liquidus. Fixed a real shipped bug: rain seeds were stamping into alloy melt that
      sat *above* its liquidus and silently remelting, wasting grain ids every frame.
- [x] **L3** — `src/nucleation.ts`: a site population (n_max thresholds ~ N(ΔT_N, ΔT_σ), sorted,
      fire-once, ratcheted on max undercooling). Rate is now emergent; recalescence stalls the
      ratchet by itself. Rail slider became "inoculant n_max"; ΔT_N/σ live in ADVANCED.
- [x] **L4** — optimizer genome g[3] rain → inoculant charge [8, 2000]; episodes run the same
      executor. Target slider capped at G 5.5 (the honestly reachable band, measured).
- [x] **L5** — `src/program.ts` + set-point (Newtonian shell) cooling: 2D reuses the dormant
      crucible scen 3 (+ a real `moldT`), 3D gets scen 4 and a rasterized mould shell.
- [x] **L6** — `src/lab.ts` LAB MODE (`#foundry`): configure charge/atmosphere/superheat/mould/
      programme, pour, live status, report card (cooling curve + recalescence arrest + sites
      used + intervention flag), share round-trip, dimension switch blocked mid-pour.
- [x] **L7** — atmosphere as an honest cleanliness proxy: air → wall oxide-film sites (shallow
      thresholds, fire early) + porosity bias in 3D. Not a bulk-nucleation control, and the
      science page says so.
- [x] **L8** — science §7 "NUCLEATION, AND THE LAB" + 6 new honesty rows + 6 references
      (Thévoz–Rappaz, Gandin, Greer, Oldfield, Dantzig–Rappaz, Campbell); tour chapters
      rewritten + a lab chapter; README; TESTING.md documents the new physics-behaviour tests.

### Postmortems / findings

1. **The 2D stats struct grew by one slot** when liqCount was added without removing the old
   `pad` — WebGPU reported it only as a *warning* ("binding size 16416 < minimum 16420") and
   every stats readback silently returned zeros. Same class as the v1.9 WGSL-warning bug:
   capture console warnings in headless tests, not just errors.
2. **`clearMelt(u)` takes UNDERCOOLING, not temperature** (T = 1 − u). Cost one wrong test.
3. **Deeply-undercooled pours nucleate less than expected** because seeds drain MAX_SEEDS per
   step and the front engulfs the late ones. Raised to 192 (2D) / 128 (3D). Only ~15 % of a
   large charge ever becomes grains — which is what Greer's free-growth model predicts anyway.
4. **Per-frame stats polling cost 20 % of the 3D frame rate.** Throttled the nucleation poll to
   20 Hz (still 5× the panel cadence). Confirmed by stashing the change and re-measuring.
5. **The A356+TiB vs Al–1Zn refinement claim no longer reproduces** under the site model
   (567 grains for the *lean* alloy vs 277 for the refined one). Not a bug: the old experiment
   held nucleation fixed and external, so it isolated growth restriction. Now an alloy's
   depressed liquidus also sets how far its melt undercools before its inoculant fires, so the
   two effects are entangled. The science-page note was rewritten to say exactly this rather
   than keep a stale number. **Open question for Frank**: whether nucleation undercooling should
   be measured from the alloy liquidus (as CNT/Rappaz do, and as it is now) is a real modelling
   choice worth revisiting if he wants that demonstration back.
6. **Timing-based headless tests of the speed multiplier are inherently flaky** — the ≥2-fence
   backpressure guard skips frames unpredictably under GPU contention. Assert the *step count
   requested* instead. (Frank's own Chrome, 94 processes, was also skewing fps probes.)

## v5.0 — REAL UNITS, A QUANTITATIVE ALLOY SOLVER, HEAT TREATMENT (2026-07-21)

Plan: `~/.claude/plans/sequential-stargazing-conway.md` (v4.0 plan archived to
`robust-puzzling-emerson-archive-2026-07-21-v40-real-physics.md`). Frank asked four
questions — is 3D complete, does it adhere to real physics, why are undercooling and
cooling rate bare numbers instead of °C and K/s, and why is annealing just a button.
Each had a real defect behind it. Scope settled via AskUserQuestion: the full-fidelity
route (similarity scaling **and** the quantitative Karma–Rappel alloy solver), all four
heat-treatment processes, all four lab-realism additions, and three of four 3D gaps
(shaped moulds, convection/freckles, Niyama + hot tearing; 3D optimizer stays deferred).

- [x] **U0** — hygiene, so the honesty claim survives contact with the rail.
      **Six dead knobs fixed**: the faceted-growth checkbox now hides in 3D unless the
      symmetry is cubic (the hex and icosahedral branches of `aniso3` ignore `facet`
      entirely); the lab's mould-walls row hides in 2D and its atmosphere note stops
      promising porosity there (porosity is a 3D field); THERM and SEM legend bars were
      keyed off the **2D** lens index in both modes *and* blanked by a `body.mode3d` CSS
      rule, so the volume's own THERM and SEM lenses rendered with no scale — both tables
      are ordered differently (2D THERM 5/SEM 6, 3D SEM 4/THERM 6) and each is now keyed
      per mode; the δ slider narrows to the icosahedral convexity cap instead of reading a
      value the shader silently clamps (new `ICOSA_DELTA_MAX`, one source of truth across
      WGSL, `setSym3` and the dial, plus a general `dynRange` on `UI.slider`); the ENGINE
      grid row exposes the whole OOM ladder via a shared `GRID3_LADDER` and always includes
      the rung the ladder actually landed on (a GPU that fell back to 96³ previously showed
      an empty selection, and 96³ was unreachable despite being advertised);
      `startOptimizer`/`startChallenge` gained mode guards (the 3D frame branch returns
      before `opt.tick()`, so either would have hung silently).
      **`Simulation.resetMold()`** kept but documented as reserved for the shaped-mould
      work rather than left looking dead.
      **Doc drift**: the VRAM figure was wrong in *both* directions — science and README
      said ~396 MB, the code comments said ~283 MB; it is 57 B/voxel over seven textures =
      **403 MB at 192³** (160³ 234 · 128³ 120 · 96³ 50), now stated once and correctly.
      **Harness**: `verify-3d.mjs` printed `FAIL` but always exited 0 — twenty-three
      assertions that could not break a build. Every check now routes through a failure
      counter that sets the exit code, page errors count, and the script joined the `npm
      test` suite (it had never been in it, despite TESTING.md saying every `verify-*.mjs`
      ran). **`PARAM-WARN`** landed in both `verify-tools` and `verify-3d`: it watches the
      browser *warning* channel for `binding size … < minimum …`, which is how postmortem
      #1 (stats struct grew a slot, every readback silently returned zeros) presented. This
      guard is a hard prerequisite for the param-table growth the quantitative solver needs.
      `npm run typecheck` promoted to a CI gate — the two `noUnusedLocals` exemptions its
      comment cited were stale, both symbols are live imports.
- [x] **U1** — `src/units.ts`: the one owner of the dimensionless↔SI map. Real SI blocks on
      nine materials (`Material.si`, added *additively* so no morphology could shift), three
      conversion factors with provenance, and a similarity report. The key realisation is that
      only one factor is free: kelvin-per-unit is **forced** by the heat equation's own latent
      coupling `(L/c_p)/K` — a real per-material number (Al ≈249 K, water ≈44 K) that had been
      sitting unused in the solver since M0 — and seconds-per-unit is then forced by whichever
      diffusivity transports (solute when the alloy is on, heat when it is not). Gated by
      `scripts/verify-units.mjs`, 8 checks, **no browser needed**, so it is the first part of
      the suite CI can actually run.
- [x] **U2** — real units everywhere, and the two bugs that fell out of having an owner.
      **(a) The µm anchor was inverted.** `umPerPx = DOMAIN_MM*1000/n` fixed a 1 mm domain and
      derived the cell pitch, so the *same physics* at 512² and 2048² reported grain diameters
      4× apart, and 2D (`/n`) disagreed with 3D (`/1024`) at every grid but the default. The
      pitch is the anchor — the phase-field interface is a fixed number of cells wide — so
      `umPerCell` now lives on both solvers and the domain is derived. `UNITS-GRID-INVARIANT`
      locks it. **(b) The composer contradicted the solver**: `TSCALE = 100` K/unit, flat
      across every metal, where the model's own factor is ~249 K for aluminium. Now
      `tScaleFor(base)`. Impact is narrower than expected — alloys already clamped by
      `DEPR_CAP` are unchanged; the dilute ones move (AA2024 2.3×, A356 ~12%).
      Readouts, rail dials, nucleation dials and the scale bar all read in °C/K/K/s/s/µm;
      a regime line names the process ("274 K/s — permanent mould · die casting"); the
      undercooling dial turns red past the Turnbull limit, which for aluminium is *inside*
      its own range. New SCALE rail section shows all three factors, their provenance, the
      derived domain size, and the groups the model fails.

### The refinement result: measured wrong twice, and nearly a third time

v4.0 postmortem #5 recorded the A356+TiB vs Al-1Zn demonstration as no longer reproducing
(567 lean vs 277 refined). Re-measured after U2, the **inversion turns out to be an artefact
too**. Two measurement flaws, neither of them physics:

1. **Equal bath temperature is not equal undercooling.** A356's liquidus sits at 0.821 where
   the lean alloy's is 0.993, so at a common start temperature the refined charge began
   *above its own liquidus* and could not nucleate until it cooled further.
2. **Equal time is not equal progress.** Growth restriction left the refined charge with 25x
   less solid at the comparison instant (fs 0.004 vs 0.106) - and grain *count* is counted on
   solid that exists.

Control both and the answer is **equivalence**: across four runs at two inoculant charges the
grain counts agree to better than 8 % (1434/1380, 1431/1445, 305/313, 351/327). Growth
restriction is plainly there - the refined charge takes ~2x as long to reach 20 % solid - but
at these site densities it does not become a finer grain count. Neither the original claim nor
its inversion survives a controlled comparison. Test: `REFINE-FAIR`.

**Postmortem — I nearly shipped a third wrong answer.** A first pass appeared to show the
textbook mechanism beautifully: the slower alloy recalescing less, holding its undercooling and
firing 3000/3000 sites against the lean charge's 1640. It was written into the science page as
a restored result. Running it inside the suite gave 1709 vs 1728 — no effect at all. The cause
is exactly **postmortem #6 from the previous release**: the harness advances the solver against
wall-clock frames and the >=2-fence guard skips them unpredictably, so the two casts had not
received the same amount of physics. Anything derived from *how far a cast got* (sites fired,
ticks elapsed) is not a controlled variable in this harness; only quantities read at a matched
physical state are. The lesson generalises past this test: a standalone measurement on an idle
machine is not a result until it reproduces under load. Settling the mechanism properly needs a
`stepSync(n)` harness entry point that awaits GPU completion, which is worth building before any
future claim rests on rate comparisons.

### Phase Q — the quantitative alloy solver

- [x] **Q0** — the solidification step split into `FLUX → PHI → TRANSPORT` alongside the fused
      `FLUX → UPDATE`, with **zero physics change**. The split exists because the anti-trapping
      current the quantitative solver needs is evaluated at cell FACES, and a fused pass only
      knows `∂φ/∂t` at its own cell — recomputing φ for every neighbour costs more than a second
      dispatch. `phiAux` (rg32float, single-buffered — written and consumed inside one substep,
      never read across the ping-pong flip) carries φ^{n+1} and ∂φ/∂t between the halves.
      Composed from ONE copy of the physics (`LOADS` / `PHI_CORE` / `TRANSPORT_CORE`), because
      two copies of the same equations is how a "refactor with no behaviour change" quietly
      stops being one. Fused stays the default: the measured cost of the third dispatch is
      **1.25×**, real but not free. `PASSSPLIT` A/Bs the shapes (worst deviation 4e-5 against a
      1e-3 tolerance, identical grain counts, pure and alloy).

- [x] **Q1** — the 2D quantitative solver, pure. `src/quant.ts` owns the thin-interface
      calibration: given a material's real Γ and D, `d₀ = Γ/ΔT₀`, `W₀ = λd₀/a₁` and
      `τ₀ = a₂λW₀²/D` **force** the cell pitch and the timestep, so `ε̄`, `τ`, `latent`,
      `delta`, `dx` and `dt` stop being dials. λ is the only thing left to choose and it is a
      *convergence* knob, not a physics one. `a₁ = 5√2/8 = 0.8839` and `a₂ = 0.6267` were
      looked up rather than remembered, and the lookup mattered: **`a₂ = 0.6267` holds only
      for `h(φ) = φ`** — the other common interpolation gives 0.3981, and this solver's heat
      source is `½∂φ/∂t`, so 0.6267 is the right one for the right reason.
      **The solver itself is a branch inside `PHI_CORE`, not a second copy of it.** The FLUX
      pass was already assembling Karma–Rappel's divergence form verbatim, and `τ(n) = τ₀a(n)²`
      was already sitting unused in the flux texture; the whole quantitative φ equation is
      seven lines, written on the stored `ψ = (1+φ)/2` and halved, because the operator is
      linear and ψ has eleven consumers that storing −1..1 would have broken.
      New: `frozenT` (the temperature is imposed, never solved — what the tip benchmarks are
      themselves derived under), `dTherm` (the heat equation's dimensionless diffusivity,
      hardcoded to 1 since M0 and now `a₂λ` when it needs to be), a tanh seed profile, and a
      `P2` slot table so the param buffer's size lives in one place while it grows 160 → 192 B.
      `Simulation.stepSync()` finally exists: the harness entry point postmortem #6 asked for.
      Gates (`scripts/verify-quant.mjs`, all green): **QPF-EQUIL** profile width 0.997 W₀ ·
      **QPF-GIBBS-THOMSON** R* = 22.21 W₀ against a predicted 22.10 (0.5 %) ·
      **QPF-CONVERGE** 6.4 % spread over W₀/d₀ = 1.81 → 3.62 · **QPF-TIP-KR** V·d₀/D = 0.01679
      against Karma–Rappel's solvability 0.0170 (**1.2 %**) · **QPF-TIP-RADIUS** ρ_p/d₀ = 28.8
      against Tong et al.'s 27.6 (4.4 %). Tip radius has two definitions four times apart in
      this literature (osculating 6.9 d₀ vs parabolic-fit 27.6 d₀) and the test says which one
      it fitted.

- [x] **Q2** — the quantitative solver, alloy, with the anti-trapping current.
      Echebarria–Folch–Karma–Plapp's dilute binary model: the supersaturation `U` is what the
      solver evolves, because it is CONTINUOUS across an interface the concentration jumps
      across by a factor k — but what is STORED is still the concentration, reconstructed from
      (ψ, U) after every substep. `uSup` and `cFromU` are exact inverses, and that round trip
      is what keeps eleven consumers (segregation etch, XRAY absorption, solute halo, the
      composition readouts, both analysis panels) working with no change at all.
      **The reference state is a real decision, not bookkeeping.** Referencing on the solidus
      (`c_l⁰ = c∞/k`) makes one dimensionless degree the full freezing range, so T = 1 lands on
      the liquidus and T = 0 on the solidus. Referencing on the liquidus instead stretches the
      freezing range to 1/k ≈ 6 degrees, which does not fit the solver's own [−1, 2] clamp.
      **The anti-trapping current is evaluated at cell FACES** — `atFace` × 4, telescoping, so
      what leaves one cell enters its neighbour exactly. 2D costs zero extra taps: the
      transverse gradient at each face averages two differences whose diagonals the 9-point
      Laplacian had already loaded. It reads ∂φ/∂t at the NEIGHBOUR, which is the whole reason
      `phiAux` and the split pass shape exist — and the reason the fused pass composes the term
      out and `splitNow` forces the split shape whenever the solver is quantitative.
      `|∇φ| → 0` is guarded three ways, one of them being that `GMIN2` is now shared with FLUX
      so the two passes cannot disagree about where the interface is. `soluteSum` went into the
      stats struct's one free header slot; the struct did not grow.
      Gates: **AT-PARTITION** k_eff = 0.135 / 0.150 against k = 0.15 with the current on, 0.186
      / 0.209 with it off · **AT-WIDTH** the trapping excess is −10 %/+0 % with the current and
      +24 %/+40 % without it, *growing with the interface width* · **QPF-MASS** 1.65e-3 over
      20 000 substeps of dendritic growth.

- [x] **Q4** — calibrated mode becomes something the app offers, and the dials it takes over
      say so. A switch in the SCALE rail section (2D only, and hidden with a reason when the
      material has no SI identity or the volume is up — a switch that silently did nothing is
      the dead-knob class U0 spent a whole milestone removing). ε̄, τ, α, γ, δ, dSol and the
      cell pitch grey out with a tooltip saying they are derived, and are **kept, not deleted**:
      share links, presets and every scene still write them, and a mode switch that quietly
      discarded a user's ε̄ would be a worse surprise than a locked slider. λ is the one control
      that appears, labelled with the W₀/d₀ it implies, because it is a convergence knob.
      **λ's default is a product decision with a physics reason.** W₀ = λd₀/a₁ sets the domain,
      and for Al–4.5Cu (d₀ = 3.2 nm) λ = 3 spans **5 µm** — a correct calibration of nothing
      anyone can see. λ = 30 gives W₀ = 109 nm, a 0.087 µm cell and an 89 µm domain at 1024²,
      which is a micrograph; W₀/d₀ = 34 sits inside the range dilute-alloy phase-field work has
      used for twenty years. A pure melt cannot have that and the reason is physics, not
      caution: its tip runs fast enough to hit τV/W ≈ 0.2 by λ ≈ 4. Hence `defaultLambda(alloy)`
      = 30 / 3. The plan predicted W₀ ≈ 119 nm, dx ≈ 95 nm and a ~97 µm domain from its own
      arithmetic; measured, 109 nm, 87 nm and 89 µm.
      **Share links restore it correctly by re-deriving it.** `dx` and `dt` are on the share
      blacklist as grid-derived, and under this solver they are material-derived too — so a
      restore re-runs the calibration from λ and the material rather than trusting the packed
      numbers, which is the only route that cannot land a solver flag on a Kobayashi timestep.
      Gates: **CALIB-BAND** the app's own shipped site potency of 0.15 is 37.4 K under Kobayashi
      scaling and **11.2 K** calibrated (3.73 K at a potency of 0.05, against the plan's
      predicted 3.9 K) — the foundry band, with the nucleation model untouched, purely because
      one dimensionless degree is now a freezing range instead of a latent-heat interval ·
      **CALIB-LOCK** ε̄ = τ = 1, the anti-trapping current on, δ taken from the material's
      measured ε₄, and the capillary group reading 0.0295 instead of "not defined".

- [x] **Q5** — the documentation, which for this release is most of the point. Science page §8
      **THE CALIBRATED SOLVER**: what the thin-interface relations buy, that λ is a convergence
      knob and not a physics one, the anti-trapping current and why an interface of finite width
      traps solute it should have rejected, and a results table carrying the *measured* numbers
      against the *published* ones rather than a claim of quantitativeness. Three honesty rows
      rewritten — the alloy row now names two solvers and says which is running, and a new row
      separates "tip radius is a shape" (default solver) from "tip radius is a prediction"
      (calibrated). Three references added (EFKP 2004, Karma 2001, Tong et al. 2001). §8 and §9
      renumbered to 9 and 10. README gains the same in short form with the reference table.
      TESTING.md documents `verify-quant`'s ten checks and — more usefully — the three things
      about it worth copying: every measurement goes through `stepSync`, the reference values
      are looked up with the paper and table named, and the plan's pre-measurement tolerances
      were replaced by what the measurements support with the reasons recorded rather than the
      numbers quietly relaxed. New tour chapter "Calibrate it" between ADVANCED and the finale.

### Phase Q — what is left

**Q3 (the 3D port) is not done, and is the honest place to stop.** The volume has no split pass
shape at all — Q0 split only the 2D solver — so porting the quantitative model there is Q0, Q1
and Q2 again in three dimensions: a second param-table growth (192 → 224 B), a lazily allocated
`phiAux3` through the *runtime* error-scope ladder rather than the create-time OOM ladder that
already exists, twelve extra taps per face for the anti-trapping current (2D needed zero — the
diagonals were already loaded), and its own gate set, since none of the 2D benchmarks transfer.
Shipping it half-built would put a solver in the volume that grows convincing dendrites with an
uncalibrated `k_eff`, which is precisely the failure mode this whole phase exists to rule out.

The release is coherent without it: calibrated mode is 2D, the switch **says so** when the
volume is up rather than appearing and doing nothing, and the science page and README state the
limit in the same breath as the capability.

**Three things the plan asked for that the measurements would not support, each replaced by
what is actually true.**

1. **`AT-PARTITION` at "> 1.25k with AT off".** Measured: 23.8 % excess at λ = 3 and 39.5 % at
   λ = 6. The threshold was written before anything had been measured and is 1 % optimistic for
   the narrow interface. The gate is stated at 1.20 for both arms rather than tuned to whichever
   one passes, and the claim with teeth moved to AT-WIDTH, where the excess must GROW with
   width without the current and not with it.
2. **`AT-WIDTH` at "< 5 %".** Below this readout's own systematic. k_eff is the ratio of two
   outer solutions AT the interface, and both have to be extrapolated there — the solid side
   because it was deposited while the pile-up was smaller, the liquid side because the peak
   sampled two cells out has already decayed a fifth of the way down a boundary layer nine
   cells deep. Reading both raw gives 0.182 against a k of 0.15, and the two biases do not even
   share a sign. The gate is 12 % on the absolute value and a *sign* on the width scaling.
3. **`QPF-MASS` at 1e-4.** Measured 1.65e-3 — and 2.06e-3 with the current switched OFF, which
   is the diagnostic that matters: the face-summed current is not the leak, it slightly reduces
   it. The residual is the (ψ, U) → c reconstruction, which is exactly conservative in the
   continuum and only O(dx²) so in the discrete. The gate is 3e-3 and the test reports the
   no-current arm alongside, so the number cannot quietly become a bug later.

**Postmortem — a fourth wrong comparison, same shape as the other three.** The width test first
reported k_eff with the current OFF as *width-independent* (0.177 vs 0.180), which is the
opposite of the truth. Both arms had been run for the same number of substeps. Under this
calibration the model velocity goes as λ² and the timestep as 1/λ, so a fixed substep budget
pushes the wide-interface arm four times further down its own transient, where the front is
slower and traps less — cancelling the very effect being measured. Matching the arms on front
displacement **in units of d₀** turned it into 0.186 vs 0.209. That is now four times in two
releases: equal bath temperature, equal wall-clock, equal distance, equal substeps. None of
them is equal physics.

There is one comparison this rule cannot rescue. Matching the physics across two interface
widths scales the model velocity as λ² while the validity bound τV/W ≲ 0.2 does not move, so
the wide arm is necessarily outside it — and trapping is only measurable at all near that
bound, because the spurious partition scales with the same Pe_W the bound does. Run shallow
enough for both arms to be comfortably valid (τV/W = 0.047) the excess is ~2 %, under the
readout's noise, and the current has nothing visible to remove. The test states which arms are
inside the bound rather than pretending the window exists.

**Deviation from the plan, and why.** The plan specified `QPF-CONVERGE` at W₀/d₀ ∈ {20, 40, 80}.
Those are alloy numbers. Echebarria et al. give the validity bound as `τV/W ≲ 0.2`, and a pure
melt at Δ = 0.55 grows fast enough to hit it by λ ≈ 4.5 — measured, not assumed: the first run
of this ladder returned 0.0149 at λ = 4.8 against a reference of 0.0170, which is that criterion
being correct rather than the code being wrong. The ladder that tests the solver instead of the
asymptotics is {1.6, 2.4, 3.2}, and the bound is now a reported column.

**Postmortem — two measurement bugs, and neither was in the solver.** The convergence test
failed twice before it passed, both times for reasons in the *harness*:

1. **`addSeed` defaults to a random orientation.** Correct for a cast, ruinous for this
   measurement: the tip is tracked along the horizontal centre row, so a grain rotated by
   anything up to 22.5° puts the *groove between two arms* on that row instead of an arm.
   Every velocity came out low, by a different amount per arm — which reads precisely like a
   solver that fails to converge in λ. Passing `theta0 = 0` moved the mean from 0.0129 to
   0.0171.
2. **Equal distance is not equal progress.** A 2D dendrite approaches steady state on a clock
   of ℓ_D/V, and ℓ_D/V differs 4× across the ladder — so scheduling every arm to travel the
   same distance parked each at a different point on its own transient, and the 20 % spread
   that produced was an artefact. Normalising the window to **eight diffusion lengths** for
   every arm collapsed it to 6.4 %. This is the same shape as the v5.0 refinement result
   (equal bath temperature is not equal undercooling; equal time is not equal progress) — the
   third instance in two releases of a comparison that controlled the wrong variable.

The rule these keep pointing at: **before comparing two runs, name the variable being held
fixed and check it is the one the physics is measured against.** Wall-clock, substep count and
travelled distance are all proxies, and all three have now produced a wrong answer here.

**Postmortem — the third silent failure of the release.** The fragment split left `inv6dx2`
declared in *both* halves. Each split pipeline includes one, so both compiled; the fused shader
concatenates both, so `UPDATE_WGSL` hit a duplicate declaration, **failed to compile, and its
dispatches did nothing** — the shipped solver produced zero solid, with an entirely clean
console. The A/B test caught it in its first run, and the bogus "6-8x slower" cost figure it
produced was just a no-op being timed against real work.

The pattern is now unmistakable across this release: **WebGPU fails quietly by default.** A
struct that outgrows its binding is a *warning* and returns zeros (postmortem #1). A shader that
fails to compile is silent and does nothing (this one). A frame-paced measurement is not
reproducible and looks like physics (the refinement result). Being more careful is not the fix —
making the channel loud is. So: `PARAM-WARN` watches the warning channel, and `shaderModule()`
now polls `getCompilationInfo()` and logs every WGSL error in both dimensions. Any future
silent-failure class should get the same treatment rather than a resolution to concentrate.

## v6.0 — HEAT TREATMENT: THE SECOND CLOCK (2026-07-22)

Plan: `~/.claude/plans/misty-marinating-sun.md`. Phase H of the v5.0 plan, which shipped U and
Q and stopped. Frank's v5.0 question — *"why is annealing just a button"* — was still unanswered:
`host.anneal(on)` set `heatIn = 1.1` while held, a uniform heat source with no time base, no
temperature target and no solid-state physics. It does not anneal, it **remelts**.

Meanwhile U1 had quietly landed the entire heat-treatment data layer and **nothing read a byte
of it**: `ggA0/ggQ/ggN`, `Ds0/Qs`, `oxA0/oxQ`, `s0/kHP` on all nine materials with an `si` block,
each with its own `source:` provenance, plus `R_GAS` whose comment already said *"the
heat-treatment Arrhenius laws use it"*. Scope was set by what that data supports: everything
except precipitate aging, which is deferred because `MaterialSI` has no precipitate kinetics and
inventing them is the one thing this instrument does not do.

**The organising idea.** Heat treatment runs on a clock ~11 orders of magnitude longer than
solidification — order 10⁻⁷ s per calibrated timestep against 1.4·10⁴ s for a four-hour soak. The
phase-field solver can never be integrated through one. So heat treatment is a separate model on
a separate clock and `src/heattreat.ts` owns the map, exactly as `units.ts` owns the
dimensionless↔SI map: real schedule → Arrhenius integral → a budget → a GPU pass that consumes
it. φ is frozen throughout, which is what solid-state means, so the two clocks never have to be
reconciled.

- [x] **H1** — `src/heattreat.ts`, the pure-TS owner: real-seconds `HeatStage`/`HeatSchedule`
      (deliberately NOT `program.ts`'s sim-time `Stage` — keeping them separate types is what
      stops either clock reaching the other's executor), Simpson integration of every rate law
      over the whole trajectory, `grainAfter`/`hallPetch`/`scaleThickness`/`decarbDepth`/
      `segregationDecay`, the budget→sweeps inversion, and `canTreat` as the single place that
      decides what may run and the single place that says why not.
      **Design change from the plan: there is no process switch.** The user sets an environment
      (a temperature schedule and an atmosphere) and the model reports what happened — grain
      growth, homogenization, oxidation and twinning all fall out of the same schedule through
      their own integrals. "Stress relief" is not a mode; it is what you get when you pick 200 °C
      and every integral comes back negligible, and the card says so *because the arithmetic said
      so*. `SCHEDULES` are presets that fill in a schedule, not switches that select a physics.
      This is the same move v4.0 L3 made when it deleted the nucleation-rate slider, and it is
      strictly better than the dropdown the plan sketched.
      Preset temperatures are fractions of each material's **absolute** melting point, because
      "600 °C" is a solution treatment for aluminium and a melt for zinc.
      Two optional additions to `MaterialSI` (`sfe`, `twinNote`) landed as *types only* so H1
      compiles standalone; H3 populates the values with sources.
      Gate: **`scripts/verify-heattreat.mjs`, browser-free**, in the `verify-units.mjs` style
      (vite middleware + `ssrLoadModule` — a test that re-implements the thing it tests proves
      nothing). Ten checks, all green, and it is now **the second suite member
      GitHub CI can actually run**: `HT-ARRH-HOLD` (against the exact closed form, rel err
      3e-15) · `HT-ARRH-RAMP` (a ramp has no elementary integral, so the reference is the same
      routine at 64× the samples — 3e-8) · `HT-RAMP-COUNTS` (a slow ramp to temperature must
      contribute; charging only the hold is a plausible-looking bug that would under-report every
      treatment — measured +31.5 % over hold-alone) · `HT-LAWS` · `HT-HOMOG-ANALYTIC` (the
      reference the GPU pass will be measured against, known-good *before* the solver exists) ·
      `HT-SWEEPS` (the inversion only — **not** `K_MC`, which H2 measures) · `HT-REFUSE`
      (15 cases, 10 refusals, and it asserts the reasons are all *distinct* — a generic "not
      available" would be the dead-knob class in a different costume) · `HT-INCIPIENT`.
      `HT-DEMO` prints the headline rather than asserting it, so a regression stays visible:
      a 1 h anneal at 0.85 T_m takes Al 12 → 20.1 µm (40 → 36 MPa), Cu 12 → 46.2 µm (57 → 41 MPa),
      steel 12 → **295.9 µm** (243 → 105 MPa).
      That steel figure makes risk 4 — grains coarsening past the specimen — a **reachable** case
      rather than a hypothetical: 296 µm is three grains across a 1000 µm domain, and *wider than
      the entire 188 µm volume* at 192³. So `domainLimitUm()` landed in H1 too: a schedule past
      the limit is **refused while its analytic answer is still printed** (`HT-DOMAIN-LIMIT`
      measures 342 µm in 2D and 64 µm in 3D — steel's anneal is legal in the plane and refused in
      the volume).

### The exponent that is not 2 — caught by a design review before it shipped

The first draft of `sweepsFor` inverted `D² − D₀² = K_MC·S`, on the reasoning that curvature-driven
grain growth is parabolic and all nine materials ship `ggN = 2`. **Ideal curvature-driven growth is
parabolic; Monte Carlo Potts is not.** The lattice pins and the state count is finite, so the
measured Potts growth law comes out meaningfully slower than the theoretical `R ∝ t^½`.

There are two exponents and the draft had conflated them:

- **n** — the MATERIAL's, `si.ggN`, in `D^n − D₀^n = ∫k dt`;
- **m** — the MODEL's, in `D^m − D₀^m = K_MC·S`, which is a *measured property of this
  implementation* exactly like `K_MC` and comes from the same gate.

They meet at the ENDPOINT and nowhere else: the material law says where the grain finishes, the
model spends whatever sweeps its own kinetics need to get there, and the trajectory between is the
model's. `HT-SWEEPS` now makes the two disagree on purpose and requires the answers to differ,
because an implementation that silently assumed 2 would have passed every other check. The cost of
the assumption, measured: **9 499 sweeps against 1 980 — a 4.8× error**, in a number nothing else
in the app would have contradicted. Same shape as v5.0's four wrong comparisons: the arithmetic was
right and the variable was wrong.
- [x] **H0** — prerequisites, no new physics. **`Sim3D.stepSync()`, which did not exist** — only
      2D got one, in Q1 — so the volume's delivered physics was always a race. Split into
      `submit()`/`step()`/`stepSync()` mirroring `sim.ts:486-566`. `STEPSYNC3` measures the gap it
      closes: **`stepSync(40)` delivers exactly 40 substeps where forty consecutive `step(1)` calls
      deliver TWO**, the backpressure guard refusing the rest. The whole 23-check 3D suite green
      through the refactor is the real assertion that behaviour did not change.
      Plus the rename: `anneal ⌛` → **`reheat ⌛`**. It drove a uniform volumetric heat source for
      as long as it was held — no time base, no set-point, no solid-state physics. It warms the
      melt and *remelts* what has frozen. Calling it "anneal" was the dishonest-label class U0
      spent a milestone removing, sitting in the rail the whole time real annealing was planned.
- [x] **H2a (solver)** — `HTMASK_WGSL` + `ANNEAL_WGSL`, the sublattice Potts pass, `Simulation.anneal()`,
      `readGrainRows()`, and **`scripts/verify-heattreat-gpu.mjs`** (7 GPU checks).
      The pass owns its own uniform buffer, and **not for the reason the plan gave**: `colour` and
      the RNG salt must vary *between dispatches*, and `queue.writeBuffer` is ordered against
      `submit()` rather than interleaved with it — so one shared struct would hand every sweep the
      same random numbers, and that stall is indistinguishable by eye from lattice pinning. Four
      structs at 256 B stride, a bind group per colour, one write + one submit per sweep. The colour
      count must stay **even**: `dir` indexes the state ping-pong too and this pass never writes
      state, so an odd count would pair a current state field with a stale grain field.

### Measuring K_MC and the exponent: three estimators, and the first two were wrong

**Shipped: m = 2.44, K_MC = 4.79.** Both measured by `GG-EXPONENT`/`GG-KMC`, which are named in
`heattreat.ts` as their provenance.

1. **Fit through the measured d₀** — railed at the bottom of the scan. An as-cast boundary network
   spends its first ~45 sweeps smoothing its own solidification roughness before any grain can
   vanish, and forcing the line through the origin makes the exponent pay for that transient.
2. **Free the intercept** — and it looked *excellent*: r² > 0.99 on every cast. It was degenerate.
   Three casts returned m = 2.41, 3.41 and 2.905 with **bands that did not overlap**, while the
   fitted d₀ wandered 3.9 → 13.6 against a measured 14.5. Three free parameters on eight points:
   the intercept and the exponent simply traded off, and the high r² meant nothing at all.
3. **Pin the intercept (the physics requires it — at S = 0 the grain size *is* d₀) and exclude the
   transient instead.** Three casts then gave 2.38 / 2.44 / 2.61 with overlapping bands.

`K` is then measured at the **shipped** exponent, never the free-fit one, because it carries units
of cells^m and is violently coupled to it: at a wandering m it swung 2.79–5.03 (80 %), and pinned it
reproduces 4.78 / 4.86 / 4.74 (2.5 %). Shipped with a 15 % drift gate, so changing the pass fails.

Two things worth keeping. **m ≈ 2.44 is the canonical 2D Potts exponent** (R ∝ t^0.41) — measured
here independently rather than looked up and adopted, and decisively *not* the ideal 2. And the
ladder **saturates** at ~8 grains across the domain, which is `domainLimitUm()` confirmed
empirically; those points are excluded from the fit and *printed* rather than dropped silently.

**Two bugs, both caught by the gates on their first run.** `self` is a WGSL reserved keyword — the
v0.8 `target` bug again, except this time the compile-info guard v5.0 built shouted it immediately
instead of leaving a silently dead pass. And **r8uint cannot be a storage texture in WebGPU at
all** (`sim3d`'s mould mask gets away with it by being CPU-written and only sampled); that one hid
behind a warning filter tuned to one known phrase, so the filter is now loud by default with two
environmental warnings named and excluded.

- [x] **H2a (panel)** — `src/heatpanel.ts` + the interlock, opened from MODES (2D via the
      rail's `only2d` gating until H2b unhides it). `lab.ts`'s four form widgets moved to a
      shared `src/formbits.ts` per the plan, not copied. The panel owns nothing but the
      conversation: temperature + hold dials (°C and minutes, material-relative defaults at
      0.85 T_m), a live prediction line (`integrate → grainAfter → sweepsFor` on every dial
      move against the casting's own census), run/abort with a per-32-sweep progress pulse,
      and a report card of measured before/after d̄ + ASTM against the law endpoint — with the
      standing caveat printed that the trajectory between endpoints is the Potts model's.
      **Refusals, each with its own sentence**: `canTreat` (abstract material, nothing solid),
      fewer than 3 grains (no starting size to measure), incipient melting straight off the
      temperature dial (≥0.97 T_m), and the domain limit — refused *with the analytic answer
      still printed*, per H1's doctrine. The stress-relief case is announced BEFORE the run
      ("predicts no measurable grain growth — run it if you want the report card to say so"),
      and a schedule past the 20 000-sweep budget says it will be truncated, at what fraction,
      and what the model endpoint of the truncated run is.
      **The interlock is in the host, not the panel**: `app.setRun` refuses `on` while
      `heat.busy`, so the space bar, the transport and a tour scene are all caught; `clearMelt`,
      `resetArmed`, `setGrid`, `canSwitchMode` and the opt/challenge/lab entries are guarded the
      same way, and the paused frame loop's `step(0)` tap-stamping is gated off during a
      treatment (a stamp writes φ, and solid state means it can't). Thermal lenses (MELT/FIELD/
      THERM) are parked to ETCH for the duration — the T field is the as-cast record, not the
      furnace (risk 10), and ETCH is where boundary migration is visible anyway.
      **`sim.anneal` gained an abort path instead of a second entry point**: `onProgress`
      returning `false` stops at the next drain and resolves to the sweeps delivered.
      Gate: **HT-PANEL** in `verify-heattreat-gpu.mjs`, driven through the DOM the way a user
      would (dial events, button clicks). End-to-end on a 1 595-grain Al cast, a 12 h/520 °C
      anneal measured **d̄ 14.0 → 48.6 µm against a law endpoint of 50.4 µm — ratio 0.963** —
      through schedule → integral → endpoint → sweep budget → Potts pass → census, ASTM G 9.7
      → 6.1; the interlock and the incipient refusal asserted in the same run. And
      `verify-heattreat-gpu.mjs` **joined `npm test`** — it re-measures K_MC's drift (0.948 of
      shipped, tol 15 %) on every suite run, because a gate that no build runs is not a gate
      (the U0 lesson, which this file had already repeated once).

### Postmortem — joining the suite caught the gate's own flaky assertions, twice in two runs

The first full `npm test` with the GPU gates in it FAILED — not the panel (HT-PANEL passed
again, ratio 1.003) but **GG-KMC**, whose free-fit exponent band came out [2.65, 3.05] on a
fifth independent cast, excluding the shipped m = 2.44, while K at the shipped exponent moved
only 8 % and the fit at the shipped exponent held r² 0.996. The three H2a-solver casts
(2.38/2.44/2.61, overlapping bands) had made band-containment look like the reproducible
assertion; casts four and five showed the band is an **r²-window statistic within one cast**,
and cast-to-cast variance of a 5-point exponent fit exceeds it. Band demoted to a printed
readout with a wide sanity rail (2.0–3.5); the gate is K-drift ≤ 15 % and r² > 0.99 at the
shipped exponent.

The rerun then failed **the same check a different way**, and this one was the real find: the
fit's POINT SET was itself stochastic. Points entered by measured thresholds — grains ≥ 100,
d ≥ 1.5·d₀ — and this cast landed **102 grains at the 5 200-sweep rung**, one grain-count over
the floor, so a saturation-shoulder point entered the fit: the exponent bent 2.85 → 3.61 and K
at the shipped m fell 17 %, a FAIL produced entirely by which points got fitted. A threshold
keyed to a stochastic measurement is a knife edge; three runs cut it three ways (94, 94, 102
grains at the same rung). The window is now **fixed in sweeps, [300, 3200]** — the same regime
fitted every run, its bounds chosen once from the measured ladder shape and recorded in the
test — while the outer rungs still run and print as the empirical saturation demonstration.
Same family as the estimator lessons above, one level up: **first the uncertainty statistic,
then the sample-selection rule, were themselves unmeasured estimators.** Meanwhile HT-PANEL's
endpoint check — an integral over the whole trajectory rather than a differentiated fit — came
in at 0.963 / 1.003 / 0.983 of the law across three runs. And this is the U0 doctrine paying
out immediately: a gate that is not in the suite does not get the run-count that finds its own
knife edges.
- [x] **H2b** — the volume's grain growth: `HTMASK3_WGSL`/`ANNEAL3_WGSL` (26 neighbours —
      6-face Potts pins hard on the cubic lattice — and 8 sublattice colours, stride-2 in
      x,y,z; the HT uniform struct, the 256 B stride and the kT doctrine all shared with 2D
      via `HT_COMMON`/`H2U`), `Sim3D.anneal()` under the 2D contract verbatim (one submit
      per sweep, even colour count so `dir` survives, φ/T/c/age untouched, abort at the
      drain), and `readGrainVolume()` as the gates' witness (rows padded to the 256 B
      alignment — n·4 is not aligned at every rung). **The mask is lazy**: r32uint because
      r8uint cannot be a storage texture (the H2a lesson), which is 28 MB at 192³ — too much
      to charge every session that never heat-treats, so it allocates on first use behind
      its own error scope (the V2 runtime-alloc pattern) and its bind groups never touch the
      frame loop. `anneal()` ends with `refreshQuats()` — no ids spawn in H2b, but H3 will,
      and the invariant belongs at the exit: leaving `anneal`, the CPU mirror is current.
      Panel in both dimensions: `census3` adapter (⟨V⟩-equivalent sphere d̄ from
      `meanVolVox`), `SWEEP_CAP_3D` 2 000 (arithmetic-bound where 2D is submit-bound),
      thermal lenses park to ORIENT (FIELD is x-ray in 3D, not temperature), and the
      **domain-limit refusal asserted as the volume's COMMON case** — the same 12 h anneal
      that legally ran on the 500 µm 2D specimen is refused on the 125 µm volume with the
      law's answer still printed (11.2 → 49.7 µm, limit ~42.7 µm).

### Measuring the volume's constants: the exponent is not the deliverable, the pair is

**Shipped: `M_MODEL_3D` = 2.25, `K_MC_3D` = 1.28**, measured by `GG3-EXPONENT`/`GG3-KMC` on
three independent 128³ casts (~2 600 grains, fully frozen). The geometry forces a different
shape from 2D's measurement: the 128³ domain limit sits at ~44 cells, so the specimen's whole
legal dial range is d ≈ 11 → 44 cells and the fit window [550, 3800] sweeps covers exactly
that band — transient excluded below ~1.65·d₀ (2D's own lesson), the wall INCLUDED because
`domainLimitUm` allows treatments to run to it. Over so short a lever the free-fit exponent
alone is poorly determined — 2.25 / 1.89 / 2.77 across casts — while **K at any pinned m is
stable to 1.8 %** (1.281 / 1.273 / 1.296). So the shipped number is the (m, K) PAIR, the
gate is K-drift + the fit's r² at the shipped m + `HT3-PANEL`'s endpoint check (measured
0.912 of the law), and the source says out loud that m is an effective endpoint-inversion
exponent over the reachable band, not a claimed asymptotic Potts exponent.

### Postmortems (H2b)

1. **The first calibration cast was 83 % solid, and the kinetics were visibly wrong** —
   liquid films between grains pin the Potts boundaries (the mask rightly excludes liquid,
   so films are walls), and the measured "exponent" was a property of the films. Freezing
   fully (quench pulses on the cast tail — the v3.0 harness lesson again) changed the free
   fit from 2.7 to ~1.9. Same family as every wrong comparison in this file: the variable
   held fixed (cast recipe) was not the one the physics is measured against (a boundary
   network free to move).
2. **The panel's census cache survived a dimension switch** — a 3D plan reading the 2D
   census (no `meanVolVox`) computed d₀ = 0.0 µm and printed it with a straight face.
   `HT3-PANEL` caught it on its first run; the cache now dies with `close()`.
3. **`plan(null)` claimed "nothing solid to treat yet"** before the first census had
   landed — factually wrong with a fully solid casting on stage. The waiting branch now
   comes first: no census is *not measured*, not *nothing solid*.
4. **`K_MC_TOL` was itself one more unmeasured estimator.** The 15 % was set from a
   within-day trio (2.5 % spread); the cross-run drift series is now −5 %, −2 %, −19 % —
   the through-origin fit weights points by S², the top rung carries ~half the fit, and its
   d̄ moves ~9 % between casts, which alone swings K by ±20 %. Widened to 25 % with that
   arithmetic recorded; the volume keeps its own `K_MC_TOL_3D` = 15 % (2 600-grain census,
   wall-anchored window, 1.8 % measured spread) rather than importing the loosening
   unearned.

- [x] **H3** — annealing twins. The DATA first: `sfe` landed with sources on the four cubic
      FCC identities (Al 166 / Ni 128 / Cu 78 — Murr 1975 compilation; Co ≈ 20 — the Co–Ni/
      Co–Cr low-SFE literature) and `twinNote` on the two cubic non-FCC ones (steel: δ-ferrite
      is BCC and annealing twins are an austenite phenomenon; SCN: BCC plastic crystal), so
      `canTreat("twins")` now runs the real matrix — Cu and Co twin, Al and Ni refuse with
      their numbers printed, steel and SCN refuse structurally, HCP refuses before SFE is
      consulted (`HT-TWIN-MATRIX`, browser-free). The PHYSICS: a Σ3 energy cusp in ANNEAL3 at
      the measured copper ratio (coherent ≈ 24 / general ≈ 625 mJ/m² → `SIGMA3_COST` 0.04),
      a Σ3 MOBILITY gate (`SIGMA3_MOBILITY` 0.02 — coherent interfaces cannot migrate by
      single-atom shuffles, which is why twins survive recrystallization), and nucleation as
      **plate events** (`Sim3D.twinEvent`): a thin disc of a fresh id in exact Σ3 registry,
      stamped on a PROBED boundary site into a CPU-known parent, its normal the parent's own
      lab ⟨111⟩ (the coherent habit plane IS the rotation axis's plane), via a read_write
      r32uint storage texture so no ping-pong parity is touched. The host budgets events
      (~0.8/grain, id-range-bounded, 24 chunks max) and the card reports twins spawned or the
      per-material refusal — in the volume only, where the question arises. Gates:
      `HT-TWIN-SIGMA3` (38 plates → 26 survive interleaved annealing, 25/26 exact Σ3 against
      their real volume adjacency, median 107 vox — visible — and 22 alive after 150 more
      sweeps) + the aluminium arm in HT3-PANEL (allocator frozen, the SFE sentence on the
      card) + `GG3-KMC` re-measured at 1.049 with all the cusp/mobility code live.

### Postmortem — two dead spawn mechanisms, and the measurement that named the barrier

The plan's growth-accident spawn — per-flip, single-cell, in-pass, the V3 claim idiom — was
built exactly as designed and measured dead: **3 of 512 spawned twins survived 300 sweeps and
none survived 450.** The first diagnosis (Σ3 boundaries need low MOBILITY as well as low
energy, which is true physics) helped by 5× and was still dead: 15/493, then 29/520 after
setting the cusp to the physical 0.04. The real killer was geometric: a cell adopting a
1-voxel twin pays ~12 neighbours of Σ3 energy where adopting the parent pays ~one — an
artificial nucleation barrier that no cusp value removes, because a {111} stacking event is
**sub-grid** for a per-cell Potts flip. Real twins are born as plates; mesoscale models in the
literature insert them. So nucleation moved out of the pass into `twinEvent` — site probed,
parent measured, crystallography exact, geometry inserted — and everything after birth stays
the pass's physics. The division is stated in the source and will be stated on the science
page: the plate is the one inserted thing, for the same reason the 2D solver does not claim
to resolve capillary-length nucleation.

- [x] **H4** — homogenization: `HOMOG_WGSL`/`HOMOG3_WGSL`, masked isotropic diffusion on c at
      frozen φ through the solid skeleton only — its own pass in both dimensions because under
      EFKP the solid diffusivity is exactly zero, so there is nothing to reuse. Every non-solid
      face (liquid, pore via its pinned φ, mould, domain edge via clamp) is zero-flux, which
      makes the exchange conservative pair-by-pair; iterations are deterministic so they batch
      hundreds per submit (unlike the Potts pass there is no RNG to decorrelate), and the count
      is forced even so the ping-pongs land home. The physical map is the whole point:
      `iterations = Dt/(cell²·D_h)` with Dt from the schedule's Arrhenius integral — no
      wavelength, no fitted constant — and the cost wall is budgeted honestly
      (`HOMOG_CAP` 40 000/4 000; the card reports the delivered fraction of the requested Dt).
      `readSoluteVolume()` landed for the volume (the plan's (d): no 3D solute readback
      existed). The card measures segregation as RMS over solid — a statistic, never compared
      against a single-mode law. **Gates `HT-HOMOG-2D/3D` are exact**: a synthetic φ=1 block
      seeded with a DCT-II mode cos(πM(x+0.5)/n) — an exact eigenvector of the clamp-edge
      stencil, which kills the boundary-artefact problem the plan's cos(2πx/λ) sketch had —
      must decay as (1−2D(1−cos k))^I: measured rel-err 9·10⁻⁷ (2D) and 9·10⁻⁷ (3D),
      conservation to 10⁻⁷, φ byte-identical, with the continuum exp(−Dk²I) and its gap
      (+0.012 % / −0.034 % at these modes) PRINTED as the model's own discretization error.
- [x] **H5** — oxidation and decarburization: the analytic parabolic laws over the whole
      schedule land on the report card — `scale x = √(∫k_p dt)` for every material with a
      sourced constant, `decarb x = 2√(D_C t)` for steel alone (its Ds IS carbon in ferrite),
      with `fmtLen` spanning Al's passive-film nanometres (2.3 nm after 14.5 h at 520 °C —
      "aluminium does not scale" made visible) to steel's mill-scale millimetres. Ice and SCN
      refuse by name (`oxA0: 0` means "no constant in the table", not "0 µm of scale").
      **The scale is deliberately not painted into the fields** — T/c/age are the as-cast
      record, and a render layer would have cost a struct-growth risk for a film that spans
      six orders of magnitude — so the card is where the number lives, and the science page
      (H7) will say so. Both panel gates assert the homog and oxide rows end-to-end.
- [x] **H6** — Hall–Petch and the report-card verdict. `hallPetch` was the last unread piece of
      the U1 data layer — measured by `HT-LAWS` since H1, called by nothing in `src/`. The card now
      closes with strength: **σ_y = s0 + k_HP/√d̄ on the MEASURED census**, before and after, and
      the row names its own three limits in one breath — grain-size strengthening alone (no
      precipitates, no work hardening; the aging row stays deliberately unbuilt), d̄ is the
      ⟨A⟩/⟨V⟩-equivalent diameter (an O(1) stereological factor off E112's mean intercept), and the
      µm under the √d̄ are the declared resolution, so σ_y inherits the "you set it" anchor (risk
      11, landed as a sentence on the card rather than a badge). The **spec is the third dial**: a
      PRE-treatment spec, σ_y ≥ X MPa with 0 = no spec, ceiling material-relative at hallPetch(4 µm)
      so one dial spans SCN's 1 MPa and a superalloy's ~600 — and it is **latched at run start**,
      because the dials stay live during a run and a spec moved after the sweeps are spent must not
      rewrite the verdict the schedule was committed to. The note pre-judges it before any sweeps
      are spent (a spec you can only check after the furnace is one you find out about too late),
      and one direction gets its own sentence: **this furnace only coarsens, and coarser is
      softer**, so a spec above the casting's current strength is unreachable by any schedule — the
      honest advice is a finer pour, printed in refusal red without disabling the run.
      Gates: inside the existing panel gates rather than new ones, because `report()` is one code
      path for both dimensions. HT-PANEL parses the σ_y row off the card and requires it to BE
      hallPetch on the same census the gate reads — measured **38.7 → 30.0 MPa against 38.7 / 30.0
      expected, exact to the printed decimal** — with a census-relative spec (σ_before − 2 → 37)
      coming back **missed**, then a near-noop second run (1 min at the dial floor, zero sweeps —
      the stress-relief case) meeting its own spec of 28: both verdict branches exercised at the
      cost of one free rerun. HT3-PANEL requires the row to ride the **⟨V⟩-equivalent d̄ by name**,
      consistent to 0.2 MPa, and **no verdict row when no spec was dialled** — a pass/fail against
      a spec nobody set would be an invented judgement. Report slices raised 800 → 1400 and
      1000 → 1600 so the new rows cannot silently fall off the asserted text.
- [x] **H7** — the share trip, science §9, README, TESTING, the tour. (The rename shipped in H0
      and the panel in H2a — no milestone should ship a pass the user cannot reach — so H7's
      remainder was the round trip and the record.) **Share**: `ShareState.ht` = [°C, min, spec
      MPa], packed only while the panel is open (the `labShare` doctrine), applied through a
      HANDOFF rather than an assignment — `buildPanel()` re-derives its dial defaults from the
      material on every open and material swap, which is the right behaviour everywhere except a
      restore, where it is exactly the clobber that would silently discard the link. The restore
      is consumed once, clamped to the material's own dial ranges (a hand-built link does not get
      to dial 2000 °C), lab wins the bottom-centre slot when a malformed link carries both, and a
      3D link's open waits inside `enter3D().then()` because a dimension switch closes the panel.
      Gate: **HT-SHARE in `verify-tools.mjs`**, deliberately the two-page BOOT idiom rather than
      `verify-3d`'s in-page pack/unpack, because the clobber lives in the applier and only a real
      reload walks it: cu at 655 °C / 240 min / spec 33 came back **field-exact through boot**,
      with the reopened panel refusing honestly — "nothing solid to treat yet" — on the staged
      link's unpoured melt. **Science §9 HEAT TREATMENT — THE SECOND CLOCK** (old §9/§10 → §10/§11;
      nothing deep-links a section number, checked): the two-clock argument, the no-process-switch
      design, the two-exponents equation block, the twin-plate postmortem as the page's second
      `.note`, homogenization's printed discretization gap, the card-not-fields oxide doctrine,
      the σ_y row's three limits, a TEST/AGAINST/RESULT table of the measured gate numbers, and a
      closing what-it-does-NOT-do (no T6 — with the why; unpinned growth; isothermal by
      construction; the finite specimen). Six honesty-table rows joined §10 (grain growth, twins,
      homog, oxide, σ_y, and "Precipitate aging / T6 — not modelled at all"), and seven references
      the heat-treatment block now stands on (Burke & Turnbull 1952, Anderson–Srolovitz–Grest–
      Sahni 1984, Murr 1975, Hall 1951, Petch 1953, Wagner 1933, E112 already present). **README**:
      a second-clock instrument bullet + a `## Heat treatment — the second clock` section in the
      calibrated-solver's shape (equations fenced, results tabled, "Limits, stated:" blunt), and
      the guided-tour bullet un-staled (ten chapters → three parts, 31). **TESTING.md** 160 → 286
      lines: both heattreat scripts documented, a Physics-behaviour tests (v6.0) group covering
      all 25 gates with their postmortems, and three stale CI claims fixed (CI gates typecheck +
      build + `verify-units` + `verify-heattreat`, per ci.yml). **Tour**: "Heat treat it" lands
      after "Run it like a lab" with `apply(a) { a.startHeat(); }` (same guard semantics as its
      sibling — `startHeat` joined `AppControl`), and the Melt·process REHEAT sentence now points
      at the real furnace instead of only disowning the brush.
      **A five-dimension adversarial review (21 findings, 10 surviving refutation) tightened the
      release before it shipped.** The three that were code: the ht decode gained the g3-style
      `Number.isFinite` whitelist — a hand-built `ht:["x","y",0]` otherwise sailed through the
      clamp as NaN and opened a panel whose note read "hold NaN h at NaN °C" with an ENABLED run
      button, a lying label on exactly the hand-built-link surface the clamp claimed to defend
      (now gated: **HT-SHARE-MALFORMED** boots the bad link and requires the panel closed). The
      spec verdict is judged at the PRINTED precision (`shownMPa`) — a float missed by a width
      the display already rounded away would put "missed" beside two identical printed numbers.
      And the temperature dial floor went material-relative: a hard 100 °C floor renders an
      INVERTED slider on the two identities that melt below it (ice at 0 °C, SCN at 58 °C) —
      a broken control, not a refusal — so they get 25 °C of dial under their own melting points
      (−25…0 and 35…58, each with a legal band under the incipient gate) while every metal's
      dial stays byte-identical. Five doc numbers were re-anchored to this ledger: 25 gates not
      21, eleven orders of magnitude not ten (10⁻⁷ s → 1.4·10⁴ s is 1.4×10¹¹ — the intro above
      said "~10" and now says ~11), 2.3 nm after 14.5 h not "a 14-hour soak", the twin ladder's
      15/493 middle rung restored to the TESTING record, and the analytic-answer clause
      reattached to the one refusal that actually prints it (the domain limit — incipient
      melting refuses with the %-of-T_m sentence alone).

## v6.1 — PHASE L: THE LAB LEARNS TO READ ITS OWN COOLING CURVE (2026-07-24)

Plan: `~/.claude/plans/twinkling-herding-iverson.md`. Built in the `v6-lab` worktree, disjoint
from the parallel Phase-H session — L1/L3 touch only `lab.ts`/`nucleation.ts`/new files, so
none of H's eight WIP files are in scope. Phase L is the next gated-open phase on the v5.0
roadmap (`sequential-stargazing-conway.md`), its U2 gate already shipped. Order L1 → L3 → L2,
each deleting a printed caveat; **L4 (Hall–Petch verdict) deferred until H6 lands** so the two
sessions don't mint two different verdicts from the same `hallPetch()`.

- [x] **L1** — thermal analysis: the lab reads its cooling curve the way a foundry reads a
      cast cup. `src/lab.ts` recorded the whole experiment (`series` of `{t, T, fs}`, fed from
      `main.ts:1341/1268` every readback) and read exactly one thing off it — `arrestPoint()`,
      a three-point local minimum that finds a "recalescence" in ANY noisy curve, including
      quenches that never recalesce. Two latent defects fell out of looking: the record was
      **silently truncated** (`series.splice(0, 400)` on overflow dropped the OLDEST samples,
      so a long run deleted its own liquidus arrest — the single most important feature — with
      nothing said), and `arrestPoint()` **could not report "no arrest"**.
      - **`src/thermal.ts`** (new, pure, no DOM — loads through vite SSR like `units.ts`):
        `analyseCurve()` extracts T_L (first departure of a *time-windowed*, not index-windowed,
        derivative from the liquid-cooling baseline), T_N/T_G/ΔT_r (recalescence = a local min
        the melt *recovers* from, found by a dT/dt sign crossing — never the global minimum,
        which is the colder solidus), T_S (last liquid), freezing range, t_f, liquid cooling
        rate. Solid fraction is reconstructed from a **single-sided Newtonian zero curve** and
        reported *against* the solver's measured census — the method's own error, not asserted.
        Every landmark it cannot resolve is a `note`, never a fabricated point. `retain()`
        replaces the splice: decimate the whole span, always keep the first, last and
        running-minimum samples.
        The single-sided baseline (not the textbook two-sided form) is forced by the probe: the
        "thermocouple" is the mean of the *remaining liquid*, which vanishes at the solidus, so
        there is no post-solidus branch to fit. Both facts are printed on the card. Refs:
        Fras–Kapturkiewicz–Burbielko–Lopez 1993; Stefanescu 2015.
      - **`scripts/verify-thermal.mjs`** — the **third CI-runnable gate** (units + heattreat
        are the other two; wired into `run-tests.mjs` and `ci.yml`). Six checks on synthetic
        curves with prescribed landmarks: `TA-SYNTH`/`TA-NOISE` (recovery, clean and at the
        readback's 0.004 noise), `TA-UNEVEN` (the SAME curve at 20 Hz→4 Hz must match the even
        sampling — the check that fails an index-based derivative), `TA-NOARREST` (a monotonic
        quench returns `nadir = null` + a note, not a fished minimum), `TA-FS` (derived vs
        prescribed f_s, RMS < 0.08 on a Newtonian-generated curve), `TA-RETENTION` (5 000
        streamed samples thinned to a 1 200 cap: span + nadir preserved, landmarks unchanged —
        gates the splice bug directly). **Both bug-catching checks proven to have teeth**: the
        old splice drops the record head to t = 13.6 and reads liquidus 0.764 vs the true 1.017
        (arrest lost); `retain()` keeps it.
      - **`src/lab.ts`** — `arrestPoint()` deleted for `analyseCurve()`; `onStats` uses
        `retain()`; the report card gains a COOLING-CURVE ANALYSIS block (landmarks in °C, K,
        K/s, ms via the existing `Units.fmt*`), the curve canvas gains T_L/T_N/T_G/T_S markers
        and the dT/dt trace, and both honesty caveats print. The nucleation-model ratchet's
        ΔT stays, reframed as the site model's global measure alongside the curve's ΔT_N.
      - **`science/index.html`** — the "not modelled" cooling-curve gap replaced by an honest
        row for what the analysis extracts and its two limits; the two references added.
      Verified: `tsc` clean, all six TA checks green, units/heattreat gates unregressed, build
      clean. **End-to-end live pour** (Al, furnace cool, argon, ×1, own vite on a port
      clear of the suite's 5199): report card renders T_L 574 °C, T_S 439 °C, freezing range
      135.7 K, t_f 736 ms, liquid rate −270 K/s. The **f_s-from-curve error came in at ±43 %** —
      exactly the honest finding the plan's risk 4 anticipated: single-sided Newtonian analysis
      on a mean-of-remaining-liquid probe is poor, and the card *says so* (a note now fires when
      the RMS is wide) rather than tuning until it agrees. A near-quench correctly shows every
      arrest landmark as *unresolved* with its reason.
- [x] **L3** — refiner fade: an inoculated charge held above its liquidus loses effective
      nucleant sites, which the science honesty table admitted was "not modelled". `nucleation.ts`
      gains `fadeFactor(holdMin)` — a short potent plateau then exponential decay to a residual
      floor (settling + agglomeration + oxide, faster than Stokes alone; the settling literature
      puts most of the loss inside the first ~30 min, so the curve is 1.0 → 0.38 at 30 min →
      0.15 floor by ~2 h). **`fadeFactor(0) === 1` exactly**, so a charge poured immediately is
      byte-identical to before this existed — the load-bearing property, gated by `FADE-IDENTITY`.
      `lab.ts` gains a "hold before pour" dial (live survived-% readout) that multiplies the
      inoculant before `setInoculant`, and a report-card line "N added, held M min → X % survived
      (Y active at pour)". Share links round-trip `holdMin` as an optional 7th tuple element
      (`share.ts` + `main.ts` labShare/restore — the `LabSetup` shape change forced the main.ts
      touch anyway, so the round-trip is done properly; old 6-element links still decode).
      **`scripts/verify-fade.mjs`** — the fourth CI-runnable gate (wired into `run-tests.mjs` +
      `ci.yml`): `FADE-IDENTITY` (0 and the whole plateau fade by nothing), `FADE-SHOULDER` (full
      potency to lagMin then a strict drop — a decay-from-t0 model has no shoulder and fails it),
      `FADE-MONOTONE` (non-increasing across the dial), `FADE-FLOOR` (bottoms at the residual, not
      zero), `FADE-FAST` (<½ survive 30 min, matching the settling data). Science row rewritten +
      Materials 2022 settling ref added. Verified: `tsc`/build/all four browser-free gates green;
      **live DOM pour** (Al, 1500 sites, 60 min hold) → card reads "21 % survived settling (312
      active at pour)" = `round(1500·fadeFactor(60))`, fade confirmed reaching the site model.
- [x] **L2** — hydrogen porosity via Sievert's law: the atmosphere→porosity link was a single
      admitted hack (`p.pPore = porePrev + (air ? 0.1 : 0)`). `src/porosity.ts` (new, pure)
      replaces it with the mechanism: a melt dissolves hydrogen as C = S·√p, the solubility
      collapses on freezing (Al liquid holds ~19× the solid), and the rejected difference feeds
      the **existing** `pPore` field — **no shader change, no new binding**. `materials.ts` si
      gains `hL`/`hS` for Al (Ransley–Neufeld 0.69/0.036 cm³/100 g at 1 atm, sourced); materials
      without the data **refuse by name** (steel has an si block but no H data → note, generic has
      no si → note), exactly the `canTreat` doctrine. Honest split baked in and printed: REAL =
      the solubilities, the √p dependence, the liquid→solid drop; PROXY = the atmosphere→p_H2
      ordering (air 1.0 / argon 0.06 / vacuum 0.0) and the rejected→pore-field gain (calibrated so
      dirty Al lands near the old +0.1 but now ordered by atmosphere and zeroed by a clean one).
      Report card prints "dissolved hydrogen X cm³/100 g (Sievert √p, {atmo}) → Y rejected → pore
      bias Z", with a 2D note that the pore field is 3D. Share link needs no change (atmosphere
      already round-trips). **`scripts/verify-porosity.mjs`** — the fifth CI-runnable gate:
      `POR-SIEVERT` (C = hL·√p; the air/argon ratio is √(p₁/p₂) not p₁/p₂), `POR-REJECT`
      ((hL−hS)·√p, >90 % of dissolved for Al), `POR-ORDER` (air>argon>vacuum, vacuum exactly 0,
      all in [0,1]), `POR-REFUSE` (steel + generic refuse with a note), `POR-KNOWN` (the
      Ransley–Neufeld numbers as a drift tripwire). Science: dedicated gas-porosity honesty row +
      atmosphere row updated + Ransley–Neufeld 1948 ref. Verified: `tsc`/build/all five
      browser-free gates green; **live DOM pours** read air 0.69→0.65→bias 0.122, argon
      0.17→0.16→0.013, vacuum 0.00→degassed/below threshold — the atmosphere ordering confirmed
      through the card.
- [x] **L4** — the lab judges (2026-07-26, after the v6-lab merge): Hall–Petch yield + a
      pass/fail verdict against a PRE-POUR spec, built by **reusing H6's verdict logic rather
      than minting a second one** — which forced the one refactor worth doing first:
      `fmtMPa`/`shownMPa` moved from `heatpanel.ts` into pure `heattreat.ts` (heatpanel now
      imports them; new browser-free `HT-VERDICT` gates the three formatter bands and the
      printed-precision doctrine directly — a miss the display rounds away judges as met), and
      the ⟨A⟩/⟨V⟩-equivalent d̄ became exported `censusDbarUm()` with the panel's private
      `dBar` delegating. One law, one d̄, one formatter, one precision rule: a casting cannot
      carry two strengths.
      - **`lab.ts`**: `LabSetup.specMPa` (0 = no spec — a verdict against a spec nobody set is
        an invented judgement), dial ceiling material-relative at `hallPetch(si, 4 µm)` exactly
        like the furnace's; the spec AND the material's strength identity (si, µm/cell) are
        **latched at the pour** — dials stay live, the verdict does not move. The card gains an
        as-cast census row (grains · d̄ · ASTM), the σ_y row naming its three limits in the H6
        breath, and the verdict row whose missed-arrow is the lab's own: a finer pour closes it
        (more inoculant, a shorter hold, a faster programme) **and the furnace can only move it
        further away** — the exact complement of H6's one-way sentence. Materials without
        strength constants refuse by name (`canTreat` doctrine); a dead census refuses as "no
        grain census landed". The panel note pre-judges what it honestly can: Hall–Petch
        inverted is a target d̄ (with "finer than this grid resolves" called out), a spec at or
        under σ₀ is "any grain size meets it" — the furnace pre-judges its law's endpoint, the
        lab cannot predict its census, so it states the requirement instead. The panel now also
        REBUILDS on material swap (the H7 buildPanel doctrine — the lab panel, unlike the
        furnace's, stays open across a swap, and a stale ceiling was another material's).
      - **Census plumbing**: `LabHost.measureCensus()` delegates to the heatHost's `measure()`
        — one guaranteed-fresh readback path for both cards. `showCard()` went async to await
        it.
      - **Share link**: the lab tuple gains the spec as an optional 8th element; old 6/7-element
        links decode; both optional tail elements (holdMin too — a latent L3 gap) now carry the
        g3-style `Number.isFinite` whitelist, so a hand-built link of strings cannot seed a NaN
        fade or a NaN verdict.
      - **`LAB4`** (verify-tools, sixth lab-family GPU gate): the σ_y row must BE
        `hallPetch(censusDbarUm(own census))` to the printed decimal (measured 30.6→30.64,
        29.5→29.48, 31.9→31.88 across runs — both verdict branches exercised organically); the
        latch is probed by shoving the dial to 999 the moment the metal is in (the card must
        keep judging the committed 30.0); a no-spec pour must print measurements with NO
        verdict row; the model metal with a spec must refuse by name. Plus `specMPa: 0` joined
        the three existing gate setup literals (the 38e67c0 lesson). **Postmortem — the gate
        caught two of its own defects before it ever gated the app**: the latch assertion
        looked for "≥ 30 MPa" where the card prints through `fmtMPa` ("≥ 30.0 MPa") — an
        assertion string that bypasses the formatter under test is wrong the moment the
        formatter is right; and one run read dUm 0 with the pour still going at poll
        exhaustion, so the pour was re-cut for the gate's business (shallow superheat, heavy
        charge, wider budget) — a gate that can outlive its own patience reads as a flake.
      - Science: §7's lab paragraph finally describes the v6.1 card (curve read like a cast
        cup, hydrogen ledger, census + verdict, the latch, the finer-pour arrow) and the σ_y
        honesty row now names BOTH cards sharing one d̄/formatter/precision. Verified: tsc,
        build, HT-VERDICT + LAB4 green ×3 consecutive, full suite before commit.

## v6.2 — PHASE D (first tranche): THE DEFECT NUMBERS BECOME REAL (2026-07-26)

Plan: `~/.claude/plans/quantified-defects-daguerre.md` — drafted from three read-only survey
agents (D1 Niyama map, D2 moulds map, full deferred-inventory audit), then put through a
three-lens adversarial panel (21 findings) BEFORE implementation. The panel's central find
changed the milestone's shape: the Niyama record itself was dishonest in the exact scenarios
that matter, and shipping an SI conversion on top of it would have been a confidently wrong
number — the failure mode this instrument exists to refuse.

- [x] **N — the Niyama number becomes a measurement, and hot tearing gets its honest index.**
      - **N0, the record**: `tDotCool` was `lapT − coolRate + heatIn` — blind to every
        scenario relaxation (Bridgman's pulled profile, the lab's holdRate shell cooling,
        which the lab runs with `coolRate = 0`), so the recorded denominator sat one to three
        orders under the real extraction. The record now carries the CONTINUOUS environment
        rate `P.envRate` (the free `_s47` slot — P3 stays 192 B): `−gradG·pullV` for scen 1/3
        (derived in writeParams), the programme's set-point slope for scen 4 (the lab supplies
        it per tick). Deliberately NOT the discrete per-substep relax: frontZ/holdT only move
        once per submit, so the discrete relax delivers a frame's cooling in one bursty
        substep — and freezing correlates with exactly that substep. **Found by the gate**: the
        first NY3 draft asserted the locked-isotherm analytic √(gradG/pullV) and measured
        0.078 vs 0.677 — first diagnosed as the burst (√75 ≈ the 8.7× gap), but the burst fix
        barely moved it, and back-solving showed G ≈ 0.07 ≪ gradG: BRIDGMAN3's state is the
        RACING regime (its own assertion is "columns race up"), where the front outruns the
        isotherm into shallow gradients and no locked analytic applies. Both fixes stayed
        (each is honest on its own), and the gate became what it should have been.
      - Seed cores stamp **−1** ("no front passed"), never the fabricated benign 25.0;
        freeze-while-warming stores −1 too (Ny is undefined without cooling — the old 1e-4
        floor recorded those voxels as maximally safe); the record clamp went 99 → 1e4 (a
        saturated record cannot be re-thresholded); the SLICE ramp got an explicit `g ≤ 0 →`
        unmeasured cold-blue branch (through the old ramp a −1 rendered as MAXIMUM risk).
      - **N1/N2, the conversion + threshold**: `Units.niyamaSI()`/`fmtNiyama()` (refuse under
        the abstract material), `P3.nyCrit` in the free `_s46` slot as the ONE owner for the
        stats counter and the render ramp. **Steel-only verdict** (the panel's refuse-by-name
        blocker): Niyama 1982's radiographic criterion 1.0 (°C·min)^½·cm⁻¹ = 0.775
        K^½·s^½·mm⁻¹ judges steel; every other material keeps a relative map — the threshold
        is steel radiography and this instrument's aluminium porosity is Sievert hydrogen. The
        section-plane legend prints the live risk census for steel, the refusal sentence for
        the rest, and names which seconds anchor it stands on (the alloy flag moves the SI
        value ~86× — the documented Lewis honesty, now carried to the legend).
      - **N3, the statistic**: stats pass counts measured-Niyama solid voxels (`counts[0]` —
        id 0 is liquid, the census loop starts at 1, so the slot was free) and those below
        `nyCrit` (the old `pad7`) — no buffer growth, the age texture joined the bind group.
        `readStats` surfaces `nyMeasuredFrac`/`nyRiskFrac`.
      - **N4, open-volume fs** (panel blocker): `fracSolid = solid/n³` counts mould-shell
        voxels that can never solidify — with walls on it asymptotes at ≈0.85, so the lab's
        `fs > 0.995` finish had NEVER fired with walls on, and no Clyne–Davies fraction past
        0.85 could exist. `writeMask` now counts open voxels; `readStats.fracSolidOpen`
        divides by them; the 3D lab's series and finish use it; every other consumer is
        byte-identical.
      - **N5, hot tearing**: `thermal.ts:cscClyneDavies()` — CSC = t_v/t_r at the published
        fractions (0.40/0.90/0.99, Clyne & Davies 1981), nulls-and-notes when a fraction is
        never reached. The lab card prints it labelled as what it is: a timing ratio off the
        GLOBAL record (the index is defined on a local element), not a stress prediction —
        **and this is the honest residue of the roadmap's "RDG hot tearing" promise: RDG needs
        a transverse strain rate and a Darcy feeding term this solver does not carry, so no
        RDG number is printed. Descope recorded here and in the science row, the two ledgers
        that promised it.**
      - **Gates**: `UNITS-NIYAMA` (dimensional closure over the layer's own methods + the
        anchor conversion from scratch + the abstract refusal), `TA-CSC` (exact ratios on
        prescribed crossings, 3× ordering, both refusal arms), `NY3` (the discrete recount:
        for freshly-frozen voxels, recorded ny must equal |∇T|/√(−lapT − envRate) recomputed
        on the CPU from the same paused state — median ratio 1.18–1.19 across runs, sentinels
        present, stats counters vs CPU recount within 2e-2; a missing term blows the ratio by
        orders). Science §10 Niyama row rewritten + a Hot-tearing row + the Clyne–Davies
        citation; README.
- [x] **P — partition k reaches the volume.** The dial was `only2d` while the 3D solver has
      honoured `kPart` since its alloy pass shipped — the inverse of a dead knob. Un-hidden
      (p() is the active solver's params, so the same slider drives both dimensions), and the
      fix exposed the deeper gap the panel predicted: `apply3DMaterial` never mirrored the
      alloy constants, so a material swap in the volume left the PREVIOUS charge's chemistry
      in the solver. c0/mLiq/kPart/dSol now mirror from sim.params (which setMaterial has
      already assigned, composer overrides included). Gate `KPART3`: al's constants land
      exactly (0.14/0.3/0.5/0.9) and do real work — max solute 0.369 > c0·1.15 after a seeded
      alloy grow.

- [x] **Gate hygiene the tranche paid for: GG3-KMC was failing at random.** The suite went red
      on `GG3-KMC` (drift 18.6 % against a 15 % tolerance) with no plausible mechanism in the
      diff — `cast3` sets `alloyOn: 0` and its own params, so neither the Niyama record nor
      the mirrored alloy constants can reach it. Re-running proved it: **six consecutive runs
      on identical code gave K/K_shipped = 1.186, 0.924, 1.057, 0.886, 0.934, 0.937** — a
      30 %-of-shipped spread, i.e. the gate reds a good build about one run in six, which is
      the mirror image of the U0 lesson (a gate that cannot fail is not a gate; a gate that
      fails at random trains people to ignore it). Two variance sources found: the calibration
      pours used `Math.random()` (now seeded LCGs in both dimensions — **the 2D twin GG-KMC is
      now byte-identical run to run, 4.7008 twice**, which is what proves the CPU seeds were
      its whole variance), and the 3D freeze loop stops on a MEASURED threshold, so the cast
      still lands at fs 0.9804–0.9807 and the ladder's d₀ moves with it. `K_MC_TOL_3D` 0.15 →
      0.25 with the six-sample evidence written into the constant's docblock — it was carrying
      a "cast-to-cast spread is 1.8 %" claim read off casts that happened to agree. 25 % is
      the 2D number and is earned the same way: outside the measured reproducibility, far
      inside what the gate exists to catch (the assumed-exponent error was 4.8×; a changed
      neighbourhood or kT moves K by integer factors), the drift is printed every run, and
      HT3-PANEL gates the same constant a second way on an INTEGRAL rather than a fit. Third
      time this repo has paid for the same lesson: fits over short levers are knife-edged,
      integrals are not.

- [x] **M — the mould gets a shape (the step block is the hero).** Closes Phase D.
      - **M1, the geometry library** (`sim3d.ts`): `setMold(kind)` over four rasterizers — `shell`
        (today's box), `plate` (thin high-floor cavity), `step` (the hero: four section
        thicknesses via `stepSectionBounds`, one common open top), `wedge` (the continuous
        version). `writeMask` goes public as the one entry — the seam a future CAD/STL voxelizer
        would call directly, no rework needed, just another `Uint8Array` + an unused kind number.
        New mould kinds deliberately land at 10-13, not 3-9: `fillPigtail`'s selector already
        owns kind 3 on the same `maskKind` field, and a collision would let a selector→lab
        scenario switch skip re-rasterizing and leave the pigtail channel live under the lab's
        physics — a real hazard the original spec text didn't call out. `maskTex` gained
        `COPY_SRC` (nothing read it back before) and a new `readMaskVolume()`.
      - **M2, the three mask-blindness fixes shaped geometry exposes**: `FEED3D_WGSL` now binds
        the mask and unconditionally re-zeroes a wall voxel's fed status every pass — the wall
        pins φ=0 ("liquid") in the main update pass, so without this the feed flood read straight
        through solid mould; `chillFloor` seeds `floorZAt(x, t) + 3.5` instead of a hardcoded
        z=2, which sat inside the shell's own wall thickness (3-6 voxels) at every grid size this
        app ships — not an edge case, the bug fired on every walled pour; `addSeed3D` funnels
        every seed source (rain, click, chillFloor, twins, the landing demo) through a new
        `clearOpenSite` that searches a small bound for the nearest open voxel and drops the seed
        if none opens, fixed once at the root rather than per caller.
      - **M3, the lab pours into it**: `LabSetup.mold` + a select beside the walls checkbox
        (3D-only, same visibility toggle); share link's `lab` tuple gains an optional 9th string
        element, whitelisted the same way `atmosphere` already is (a missing or garbage kind
        decodes to `"shell"`, so old links keep working). Four `.mjs` `LabSetup` literals needed
        the field for runtime correctness (`scripts/*.mjs` sit outside `tsconfig.json`'s
        `include`, so `tsc` can't catch a missing one) — three in `verify-tools.mjs`, one in
        `verify-3d.mjs`, found by grep, not by guessing there'd be exactly one.
      - **M4, per-section measurement**: `REGION3D_WGSL`/`Sim3D.readRegion` generalizes the
        existing plane-stereology pass to an axis-aligned box, following the `LineU` precedent of
        its own tiny uniform rather than growing `Params3D` or reusing `stereoParamBuf` (both
        exist specifically because a SHARED buffer caused the original stereology race).
        `regionCensus` (`heatpanel.ts`) reduces `readRegion`'s raw per-grain counts into a
        `Census` — deliberately reusing `readRegion`'s own ≥4-voxel noise floor and the section
        table's `grainCount < 3` refusal rather than inventing a second, region-scaled threshold
        with no precedent anywhere else in the repo. The lab card's new section table (thickness
        · local d̄ · σ_y, thinnest first) reuses `censusDbarUm`/`hallPetch` verbatim — the L4
        machinery, applied four times — and notes that a grain spanning two sections counts in
        both, the same thing a metallographer's per-field measurement does.
      - **M5, gates**: `STEP3` (four checks — exact rasterization vs a real GPU mask readback;
        `readRegion` vs an independent CPU recount, byte-exact; freeze-time ordering via the age
        record; regional d̄ growing thinnest→thickest) and `FEED-MASK` (two sealed chambers, one
        riser-connected and one capped short of the top) both join `verify-3d.mjs`, which gained
        the Vite-SSR module-loading pattern `verify-heattreat-gpu.mjs` already used. Both were
        calibrated against a live pour before being fixed in place, and both calibration runs
        found real, non-obvious things: a **"quench" cooling programme's strong set-point
        coupling swamps the geometric wall-conduction effect between step-block sections
        entirely** (all 4 sections froze within a narrow band, no usable ordering) — switching to
        `furnace` (the weakest coupling) let the real physics dominate and produced a clean,
        reproducible ordering across two independent runs (17.7→23.5 µm and 19.5→22.1 µm,
        thinnest to thickest); and the FEED-MASK differential needs `submit()`'s own dispatch
        fooled into leaving a hand-built mask alone, done by reusing the pigtail's kind=3 rather
        than a new number, which is also what proved the M1 collision hazard was real.
        `MOULD-SHARE`/`MOULD-SHARE-MALFORMED` join `verify-tools.mjs`, mirroring `HT-SHARE`'s
        pair for the new tuple element. Science §6/§7/§10, README, `tour.ts`'s existing "Section
        it" chapter (extended, not a new chapter — it was already the stereology lesson this
        connects to), `TESTING.md`.
      - **A process note worth keeping** (`tasks/lessons.md`): editing `src/**` while
        `npm run test` or any browser-driven `verify-*.mjs` is live against the dev server feeds
        Vite HMR a page reload mid-test, which crashes whatever GPU check is in flight with
        `Execution context was destroyed, most likely because of a navigation` — indistinguishable
        from a real regression without stashing and re-running to isolate it, which is how the
        first two "crashes" this session turned out not to be bugs at all.
      - Full suite (17 scripts) green end to end, twice, including every new gate, with the
        second run showing the same clean orderings from independent RNG draws — not a
        one-off pass.

## v6.3 — Lab Mode UI rework: no auto-popup, a Results button, integrated styling (2026-07-27)

- [x] **The report card no longer pops up on its own.** Shipping the step block's per-section
      table made an existing complaint sharper: the report card auto-appeared the instant a pour
      finished, its five content pieces were mostly one undifferentiated block of text (only
      `thermal` and, internally, `sectionTable` were actually boxed), and the setup panel itself
      was a dense `auto-fit` CSS grid crammed into a wide-but-short strip at the bottom — visibly
      disconnected from the rail's own single-column, spacious language. Grilled via
      AskUserQuestion before touching anything; two of four answers landed against the
      recommended default (setup panel stays separate rather than merging into the rail; results
      open in a slide-in panel rather than a centered modal), which is exactly the value of
      asking instead of assuming.
      - **Setup panel** (`Lab.buildPanel()`): grid → `flex-direction:column` single-column stack,
        narrower (`min(320px,90vw)`, was `min(760px,88vw)`), header typography matched to the
        rail's `.sec h2` (dim, letter-spaced) instead of a cyan accent. A new **"▤ results"**
        button sits beside "▶ pour and run", disabled until a run finishes.
      - **No auto-popup**: `finish()` no longer calls `showCard()`; it measures
        (`measureCensus`/`measureSections`, same guaranteed-fresh readback as before — the sim is
        paused by finish time, so measuring now vs. on-click is equivalent) and builds the report
        into an already-in-the-DOM-but-hidden `#foundryResults`, then enables the Results button
        with a one-shot CSS pulse (`animationend`-cleaned so it can re-fire on the next run).
        Starting a **new** pour hides the panel and disables the button again — showing a
        superseded run's numbers would be exactly the stale-data dishonesty the operator-
        intervened flag already exists to catch.
      - **The slide-in panel**: not the "⤢ enlarge" pattern first cited when asking (that turned
        out to be a centered, dimmed-backdrop modal — the opposite of what was chosen, caught and
        corrected mid-conversation) — the real precedent reused is **`#rail`'s own mechanism**
        (`transform:translateX` + a `.hidden` class, `ui.ts:166-169`), mirrored to the **left**
        edge so the two never compete, no dimmed backdrop, the live sim stays interactive behind
        it. `#foundryResultsBody` persists across pours (element built once per Lab Mode session
        in `buildResultsPanel()`, mirroring `#rail`'s own lifecycle) rather than being
        removed/recreated like the old `#foundryCard` was.
      - **Report content → cards**: a new `Lab.rcard()` wraps each section in the app's existing
        small-panel idiom — `.apanel`'s look (border/background/radius) under its own class
        (`.rcard`) since `.apanel` is `display:none` by default outside `#apanels`. Five cards:
        Cooling Curve, Cooling-Curve Analysis (already boxed, just re-skinned), As-Cast Strength
        (newly boxed, only rendered when non-empty), Section Table (step mould only, unchanged
        internally), Run Summary (nucleation ratchet + refiner fade + inoculant + f_s + Clyne–
        Davies + porosity, newly boxed) — the operator-intervened line stays a plain footer, not
        a sixth card, since it's a one-line caveat rather than a data section.
      - **A live bug the manual browser pass caught, that typecheck couldn't**: `finish()` calls
        `refresh()` *before* the async `buildReport()`'s measurement lands, so the status line
        kept reading "ready… nothing poured" even after the Results button had visibly enabled —
        fixed by having `buildReport()` call `refresh()` again once `hasResults` actually flips.
        Exactly the class of bug "start the dev server and look at it" exists to catch.
      - Gates: `document.getElementById("foundryCard")` → `"foundryResults"`/`window.__solidify.
        lab.hasResults` across `LAB`/`LAB4` (`verify-tools.mjs`) — the polling pattern (element/
        flag exists → read text) is unchanged in spirit, since the panel now persists hidden
        rather than being created fresh at finish time. `verify-tools.mjs` green twice
        (`LAB`/`LAB4`/`MOULD-SHARE`/`MOULD-SHARE-MALFORMED` all OK both runs); `ATMOSPHERE` failed
        once (`maxLead:0`) then passed clean (`maxLead:150`) on an identical re-run with no edits
        between them — reproduced as a pre-existing flake in a gate this change never touched,
        not a regression (the same class of lesson `GG3-KMC`'s tolerance already recorded).

## v7.0 — CONTROLLED EXPERIMENTS (2026-07-28)

Plan: `~/.claude/plans/crystalline-sniffing-volcano.md`. Frank was asked which of the three
remaining roadmap arcs to build — v7.0 controlled experiments, Q3 (the 3D quantitative port),
D3 (convection/freckles) — and answered **all three**. They are sequenced as three releases,
v7.0 → Q3 → D3, and the reason for that order is gate shape rather than rework:
`verify-passsplit.mjs` gates the 2D FLUX→PHI→TRANSPORT split as a *zero-physics-change* refactor
(a bit-exact trajectory comparison). Q3c is that same milestone in the volume. If D3 landed
first, advection would go into the fused 3D UPDATE and Q3c could no longer be zero-physics-change
with a bit-exact gate — so Q3 before D3 is the only order in which `PASSSPLIT3` has teeth.

The plan was written from three read-only survey agents (v7 surface, Q3 surface, D3 surface) and
then put through one adversarial planning pass before any code, the same shape that worked for
Phase D. That pass changed four decisions and is the reason several of them are what they are —
each recorded at its own milestone below.

- [x] **C0a — the app becomes reproducible.** `src/rng.ts`: one seeded generator, and every
      stochastic choice in the physics path now descends from it. Before this, ~41 `Math.random()`
      call sites across seven files made a run unrepeatable — grain orientations, the 3D Marsaglia
      quaternions (every 3D grain's orientation), nucleation site placement and its activation
      Gaussian, chill-wall and chill-floor jitter, the twin probe's site search. The cost of that
      is already in the ledger: `K_MC_TOL_3D` had to be widened 15 % → 25 % precisely because an
      unseeded pour moved the measured constant cast to cast (its docblock's six runs spread
      0.886–1.186 on identical code), and the three verify scripts that needed determinism each
      grew their own hand-rolled LCG in `scripts/` — fixing the harness and leaving the app
      irreproducible. `CONTRIBUTING.md` already told contributors "the simulation is deterministic
      given a seed"; this makes that true.
      - **The seed is drawn, not fixed.** A fresh visit gets a fresh cast — an instrument that
        showed the identical snowflake on every reload would be a worse instrument. What changed
        is that the seed is *recorded*: it rides the share link, it is printed in the ENGINE
        section beside a "new seed" button, and a gate can pin it. That is how an experiment logs
        a generator, and it is why the one surviving `Math.random()` in `src/` is the one that
        draws the seed.
      - **Streams are derived by name, not by splitting** — `stream("sim3d")` hashes the name
        (FNV-1a + avalanche) into the seed. Two consequences, both load-bearing: one subsystem's
        draws can never perturb another's (the optimizer searching does not move the pour, a
        landing animation does not move a gate), and **adding a new consumer never shifts an
        existing one's sequence**. Under a sequential split, D3's convection stream and C3's
        recrystallization stream would each renumber everybody on arrival and silently move every
        measured constant in the suite. Gated by `RNG-NAME-DERIVATION`, which adds two unborn
        stream names and requires `sim2d`'s next 16 draws to be byte-identical.
      - mulberry32, not the `x*1664525 + 1013904223` LCG the verify scripts carry: that LCG's low
        bits are poor, and two consumers here (Box–Muller, Marsaglia) pair consecutive draws,
        which is exactly where a weak generator shows up as structure in the output. Measured over
        20 000 draws: gauss mean 0.0074, sd 0.9956, sign bias 0.0017.
      - `randomQuat` and `sigma3Of` went from `static` to instance methods so they can reach the
        volume's stream — a static `randomQuat` would have left the single largest source of
        randomness in 3D unseeded while everything around it was reproducible.
      - `reset()` (2D and 3D) and `Nucleation.stage()` rewind their own stream, so the same seed
        poured twice is the same pour, and `restage()` after a knob move re-places the same
        particles rather than reshuffling the population every time a slider moves.
      - Share: `ShareState.seed`, optional (every pre-v7 link still restores), `Number.isFinite`
        whitelisted per the g3 doctrine, and applied **first in the boot applier** — ahead of
        `setMaterial` and `applyNucShare`, both of which redraw. A seed restored after them would
        be a seed the restored cast never used: the same shape as the H7 clobber, where the damage
        lives in the applier rather than the decoder.
      - **A bug caught in review before it shipped**: `setSeed` first re-derived streams by
        swapping the registry entry for a fresh `Rng`. Every consumer caches its stream in a field
        (`private rng = stream("sim3d")`), so that would have left all of them drawing from the
        OLD seed — a seed control that visibly does nothing, and a share link that restores a cast
        it did not actually reproduce. `Rng.rederive()` now mutates in place, and
        `RNG-REDERIVE-IN-PLACE` gates exactly that: hold a cached stream across a `setSeed` and
        require it to follow.
      - **Gates.** `scripts/verify-rng.mjs` — seven browser-free checks (`RNG-DETERMINISM`,
        `RNG-STREAM-INDEPENDENCE`, `RNG-NAME-DERIVATION`, `RNG-REDERIVE-IN-PLACE`,
        `RNG-DERIVED-DRAWS`, `RNG-SEED-ROUNDTRIP`, `RNG-NUCLEATION`), joining `npm test` and the
        **CI set** as its sixth browser-free member. Plus `RNG-REPRO` in `verify-tools.mjs`: a
        real 512² cast driven by `stepSync`, comparing the **full per-grain census** — same seed
        gives 400 grains, fracSolid 0.981033325 and all 400 diameters byte-identical across two
        independent casts; a different seed gives 0.979911804. `SHARE ROUND-TRIP` gained the seed
        and now sets an exit code (it previously printed `MISMATCH` without failing the build).
      - **`RNG-REPRO`'s first draft passed for the wrong reason and its own difference-half caught
        it**: driven purely by `stepSync`, all three arms produced `fracSolid: 0` — because the
        emergent nucleation model only fires when a stats readback lands, and those arrive on the
        FRAME loop, which `stepSync` never drives. Three empty results compared equal and reported
        "reproducible". Two fixes: the cast now seeds through `app.scatterSeeds` + `addSeed`
        *without* an explicit `theta0` (the canonical helper in `verify-heattreat-gpu` passes its
        own seeded angle, which is right there and would bypass the very draw under test here),
        and the gate asserts `castGrew` before it asserts anything about identity. Nucleation's own
        reproducibility moved to `RNG-NUCLEATION` in the browser-free script, where it belongs —
        it is pure CPU, so it is faster and CI-runnable there. Lesson shape: **an identity
        assertion needs a liveness assertion beside it, or "nothing happened twice" reads as
        success.** (Also a second defect the same run exposed: the readback field is `grainCount`,
        not `grains` — `st.grains` was silently `undefined` on both sides of an `===`.)
      - Live browser pass on the UI row, per the v6.3 lesson that typecheck cannot see a dead
        control: the note renders (`seed 0c3f8a60 — shared links carry it, so the same cast pours
        again`), the "new seed" button exists, clicking it changes the seed, and the readout
        follows it.

- [x] **C0b — three documents were printing a number the code had retired.** Kept deliberately
      separate from C0c (which is a physics change) so that a suite failure in this window has
      one candidate cause rather than five.
      - **The defect.** `K_MC_TOL_3D` was re-measured 15 % → 25 % in v6.2, and its docblock
        recorded why in full: six consecutive runs of `verify-heattreat-gpu` on identical code
        returned K/K_shipped = 1.186, 0.924, 1.057, 0.886, 0.934, 0.937, and the cast-to-cast
        spread the 15 % had been justified by "was read off casts that happened to agree". Three
        documents never followed: `TESTING.md` said the volume "keeps `K_MC_TOL_3D` = 15 %, earned
        by a measured 1.8 % spread"; `README.md` said "K stable to 1.8 % across casts"; and
        `science/index.html` — the honesty page, whose entire job is to be true — printed
        "K = 1.28 (1.8 % spread), drift gated at 15 %" in its measurement table. All three now
        quote the shipped tolerance and the real six-run spread. Of everything found in the v7.0
        surveys this was the one defect that was flatly a false claim rather than an absence.
      - **`HT-DOC-CONSTANTS`** (new, in browser-free `verify-heattreat.mjs`, so it is in CI):
        reads the tolerances and the (m, K) pair from the module and requires each document to
        quote *those* numbers, plus bans the two retired claims by text. Deliberately narrow — it
        does not parse the prose around them, because a gate that policed wording would be
        abandoned the first time someone edited a sentence. **It failed on its first run and the
        offender was this very milestone's own new TESTING.md sentence**, which quoted "1.8 %
        spread" in the course of explaining why that claim was retired. Rewritten to describe the
        retired claim rather than restate it: a gate that has to understand quotation is a gate
        that produces confusing failures later.
      - **The δ and solute-D dead knobs.** `setSolver` overwrites both (`delta: si.eps4`,
        `dSol: q.dTilde`) and the note under the calibration switch already told the reader δ was
        "no longer a choice" — but neither slider was in `Ui.derived`, so both stayed fully
        interactive. The sentence was right and the dials had not been told. Both now join
        `derived` (five rows → seven), which is also exactly what `todo.md`'s own Q4 entry claimed
        greys out — the docs had recorded the intent and the implementation was short of it. The
        note now names the solute D as well. Verified live rather than by typecheck: OFF `1/auto`
        on every row, ON `0.42/none` on ε̄, τ, δ and solute D alike, and clean restoration on
        exit. (The first probe reported *nothing* greying, including ε̄ which predates this
        change — a bug in the probe's own selector, which matched an ancestor of the `.row`
        rather than the `.row`. Worth recording: when a check says a long-shipped feature is
        broken, suspect the check.)
      - Two stale in-code references corrected: `sim.ts`'s htMaskTex comment said `r8uint` where
        the code creates `r32uint` (r8uint cannot be a storage texture in core WebGPU at all —
        which is the actual reason both dimensions pay 4 bytes a cell for a one-bit fact, so the
        comment now says that), and `heattreat.ts` cited `sim.ts:623` for the ASTM three-grain
        floor, which now lives in `readStats`'s `count >= 3` guard — named by symbol rather than
        by line, since a line number is a reference that rots on the next edit.
      - Noted for **C1**: `K_MC_TOL_3D`'s docblock names two sources of its spread, and C0a just
        closed one of them for the app (the pour's orientations are now seeded). The 3D gate does
        not yet pin the app seed, so the tolerance is unchanged here — re-measuring it is a
        *measurement* task, which is precisely what the comparator layer exists to do, and it is
        the honest place to earn a tighter gate rather than assert one.

- [x] **C0c — the pore branch was dropping the solute on its way out.** `update3dWgsl` has four
      `return;` paths: the out-of-bounds guard (writes nothing), the mould wall, an
      already-a-pore voxel, and a voxel voiding for the FIRST time. The first three were
      consistent; the fourth wrote `stateOut` and `grainOut` and returned **without** writing
      `soluteOut`, while both of its siblings pass `conc` through. Under the ping-pong that left
      the output slot holding what had been written two substeps earlier — the next pass read
      that stale value back, and the already-a-pore branch then preserved it for the rest of the
      run. Latent today; a real conservation hole the moment D3 advects solute through these
      cells, which is why it is fixed now rather than in D3.
      - **Landed alone, and the reason is in the measurement.** The plan called for a "mass
        witness". Building it found that total solute is *not* conserved in the 3D alloy model at
        all — it grew 51 % over a freeze in the first probe — because the Warren–Boettinger
        rejection term (`+(1−k)·c·dφ`) is a source and is explicitly not in flux-conservative
        form. So a conservation drift is the wrong witness: it would have been a tolerance
        wrapped around a number that moves for reasons unrelated to this branch.
      - **The A/B could not isolate it either, and that is the interesting part.** Same seed,
        fix vs no fix: 24 560 pores against 26 324. The solute field feeds back into freezing
        through the constitutional undercooling, so changing one voxel's solute changes where the
        next one voids, and the two casts diverge into genuinely different castings within a few
        hundred substeps. Differencing them measures the divergence, not the branch — the
        wrong-comparison class this repo has now paid for a fifth time. (The first attempt at a
        continuity metric duly reported 43 % vs 36 % "exactly continuous" and a max jump of
        0.016 vs 0.022 — a real difference in the tail, 96 large jumps down to 7, but not a
        number any honest gate could be built on, because the two arms were no longer the same
        experiment.)
      - **So it is gated structurally, which is what was actually provable.**
        **`POR-PORE-SOLUTE`** (browser-free, in `verify-porosity.mjs`, so CI runs it) loads
        `update3dWgsl` and asserts the invariant directly: in the alloy build, **every exit that
        writes the state must also write the solute** — and in the base build, none may, since
        `layout:"auto"` drops unused bindings and dummy-binding storage is the v1.9 black-canvas
        bug. Cross-checked against the structure rather than a magic number (`alloyStores ===
        stateExits + 1`, the extra one being the normal fall-through path). **Verified against
        both arms**: it fails on the pre-fix shader naming `exit 3` exactly, and passes on the
        fixed one.
      - Two defects in the gate itself, caught before it shipped: the count assertion was written
        as 3 when the answer is 4 (three early exits plus the main path), and the branch body was
        first isolated with a fixed 600-character window — which the long explanatory comment
        added in this very commit pushed the `stateOut`/`grainOut` writes out of, reporting
        `writesState: false` and letting the invariant pass **vacuously**. The window now runs
        from the last `{` before the return, so it is the branch body by construction and cannot
        drift with comment length. Same failure shape as C0a's: a check that reports success
        because it stopped looking at the thing it was checking.
      - Hit a documented lesson head-on while writing it: the explanatory comment originally
        contained backticks around an identifier, **inside a WGSL template literal** — which
        terminates the literal and breaks the build (Phase Q lesson 5, already in the ledger).
        `tsc` caught it as `TS1005: ',' expected`. Also cost one confusing cycle: a stale dev
        server left over from the previous milestone was still holding port 5199, so the first
        probe run was served pre-edit code behind a 500.

- [x] **C1 — the comparator, the sweep bench and the scatter band (`src/experiment.ts`).** The
      five wrong-comparison postmortems in this file are the spec, and the module makes both
      halves of their rule structural: a `SweepSpec` cannot RUN without naming the one swept
      parameter and the variable held fixed (an undeclared comparison throws — programmer
      error), and every cast returns `ctrl`, the achieved value of the matching variable, which
      the bench checks across every run of every arm against the spec's stated tolerance —
      REFUSING to render means or bands when the arms did not actually sit at the matched state.
      Naming a proxy no longer helps; the achieved spread is measured, printed on the rendered
      output, and gated. The answer to the fifth postmortem (feedback-coupled A/B divergence) is
      the replicate axis: N recorded seeds per arm, band against band, range not σ.
      - **The stats extraction.** The through-origin power-law fit + r²-window band that
        `verify-heattreat-gpu.mjs` inlined four times (2D scan, 2D fit-at-shipped-m, 3D scan,
        3D fit-at-shipped-m) now lives in `fitPowerAt`/`scanPower`, same arithmetic in the same
        accumulation order; the GPU script imports them via `ssrLoadModule`. **`EXP-FIT-PARITY`**
        (browser-free, CI) holds the extraction `Object.is`-exact against a VERBATIM copy of the
        old inline code on an exact and a jittered ladder — the PASSSPLIT doctrine applied to
        statistics — with a finiteness clause, because `Object.is(NaN, NaN)` is true and two
        broken fits would otherwise "agree" (the identity-needs-liveness lesson, applied at
        write time for once).
      - **The nucleation-live deterministic cast (`castCensus`)** closes the science page's own
        "cannot yet do" sentence: sites fire off frame-loop stats arrivals, so a stepSync cast
        used to mean a nucleation-dead cast (RNG-REPRO bypasses the model with scatterSeeds).
        The bench drives it synchronously between fence-paced chunks — update → stepSync →
        readStats-with-retry → observe, the frame loop's own order — with two determinism holes
        found and closed at design time rather than by a flaky gate: (1) the app's 4 Hz panel
        poll lands `nuc.observe` at wall-clock times and would poison the ratchet, so the
        `__solidify.experiment` cast wrappers hold it off (`benchHold` guards exactly that one
        call in the frame loop's stats callback); (2) a >MAX_SEEDS emission burst would split
        its stamp batches at a point decided by whether the idle `sim.step(0)` got a rAF in, so
        the queue is drained with `stepSync(0)` before growing, sized to the burst.
        **`EXP-REPRO-LIVE`** (measured): 246 emergently-fired sites, census byte-identical
        across two same-seed casts, different seed differs, liveness asserted (`castGrew`).
      - **`castTip`** is one QPF-CONVERGE arm as a controlled cast — θ₀ = 0, distance-scheduled,
        ℓ_D-normalised window, ctrl = achieved travel in diffusion lengths — implemented
        INDEPENDENTLY of `verify-quant.mjs`'s private copy on purpose: two witnesses asserting
        the same published constant every build cross-check each other, where one shared
        implementation would let a bug assert itself (noted in `phiCross`'s docblock; Q3b
        extracts THIS copy for the 3D tracker). **`EXP-TIP-ANCHOR`** (measured): V·d₀/D =
        0.01678 against KR-1998's 0.017 — 1.3 %, the gate anchored on a constant this arc does
        not touch, deliberately not `K_MC`, which C2/C3 are designed to move.
      - **The gate corrected itself twice before shipping, both times by its own doctrine.**
        (1) The first cut demanded `|plateau − 1| < 0.05` — a tolerance written before
        measuring, the exact Phase-Q lesson — and failed its own honest arm (measured
        vW0/vMid = 0.9416 at 8 ℓ_D while landing 1.3 % off the published number; QPF-CONVERGE's
        real assertion is arms in step with EACH OTHER). Replaced with the measured band
        [0.9, 1.02], reason recorded at the assertion. (2) The sweep's first cut used tol 0.08
        on matched solid fraction, which let a budget-exhausted arm that never reached fs 0.5
        (read at 0.447 when `maxChunks` ran out) pass as "matched" — precisely the failure the
        bench exists to refuse. Budget raised so both arms genuinely reach the read state, and
        the tolerance re-sized to what it is actually for: measured chunk overshoot
        (0.5002–0.5067 → tol 0.03). **`EXP-SWEEP-CONTROLLED`** (measured): coolRate {0.2, 0.8}
        × two seeds, grain count at matched fs, ctrl spread 0.0065 within ±0.03, replicate
        bands alive (±11.2 % and ±4.5 %), v4.0's direction holds (288 vs 170 — faster cooling,
        finer grains), and the rendered text names the controlled variable.
      - Also caught in the browser-free half's own first run: the "shrinking ladder" intended
        to prove K > 0 admissibility wasn't inadmissible at all — rungs merely decreasing with
        S still sit above the pinned d₀, so every S·y product stays positive and so does K. A
        truly inadmissible ladder must sit BELOW its own as-cast d₀ (`EXP-FIT-INADMISSIBLE`
        says why in its comment). And the GPU half's paint smoke check first counted every
        pixel as "painted" — comparing against the literal fill colour, which the 0.88-alpha
        backdrop never stores; it now diffs against the backdrop as painted, read from a corner
        nothing draws on.
      - Surface: `window.__solidify.experiment` (module functions + the two cast wrappers that
        take `benchHold`). No rail UI in C1 — the layer's consumers today are the gates, C5b's
        figure scripts, and C2/C3's measurement tasks (re-measuring `K_MC_TOL_3D` under a
        pinned app seed is the first one queued). `drawBand`/`bandLayout` ship gated
        (layout content browser-free, painter smoke-tested on a real canvas) so the first UI
        consumer inherits a tested renderer rather than a new one.
      - Docs: the science page's "measured wrong twice" note loses its "cannot yet do"
        sentence in favour of what now exists and where; TESTING.md gains both script entries
        and the CI-set count fixed 5/6 → seven (the intro's five-script list had been accurate
        until C0a added `verify-rng.mjs` and stale since — the same doc-drift class
        HT-DOC-CONSTANTS exists to catch, found by this milestone's survey).
      - **Adversarial review before commit (5 finder lenses → 20 raw findings; skeptics
        confirmed 2, refuted 8; the unjudged tail hand-triaged to 5 more fixes).** The two
        confirmed: (1) `benchHold` guarded the poll's `nuc.observe` but not the TRANSPORT — a
        running frame loop (Space mid-cast is enough) would inject frame-paced `nuc.update` +
        `sim.step` around the cast's fence-paced chunks; the frame loop's cast branch now gates
        on `running && !benchHold`, falling through to the idle stamp branch the drain is
        already sized for. (2) the sweep gate asserted ctrl SPREAD but never ATTAINMENT — two
        arms that both budget-exited at similar fractions would render as matched at a state
        nobody declared; the gate now pins every run's ctrl ≥ the declared read point AND
        `castCensus` returns ctrl = NaN on a budget exit (a run that never reached its declared
        state is a non-measurement — the achieved fraction stays in `fracSolid` for the refusal
        to print). From the tail: `castTip`'s melt-back cancellation (vW0 < 0 flips both the
        travel and ℓ_D, so a retreating front computed a plausible POSITIVE "9 diffusion
        lengths" — ctrl now refuses unless vW0 > 0); EXP-REPRO-LIVE compared five rounded
        aggregates while the docs said census-identical — it now compares the per-grain
        diameter list element-wise at RNG-REPRO's own precisions; and the stamp-drain divisor
        was a hardcoded 96 where `MAX_SEEDS` is 192 (safe direction, twice the drains needed,
        but a magic number where the constant exists — now imported).

- [x] **C2 — Zener pinning, as a mode on the HT uniform.** The mechanism was already in the
      building: the H2b postmortem watched liquid films pin these boundaries because the mask
      excludes them — so a Zener dispersion is PURELY a mask-pass feature. A deterministic
      particle fabric (hash-derived centres, discs/spheres of radius r cells at nominal
      fraction f, one fixed fabric salt shared by both dims) is marked mask-ineligible; the
      anneal shaders are UNTOUCHED, no grain id is written, no census entry appears, and the
      renderers see nothing. Parameters ride writeHt: fraction in the pinF slot (the one slot
      free in both dims), radius in flags bits 8..15. Default 0 = the pre-C2 furnace, byte for
      byte, in the uniform struct itself.
      - **The law is measured, and it is this lattice's own.** Nine plateaued ladders
        (f 0.03–0.12, r 1–5 cells, two starting structures; each ladder 5–27 s) fit
        d_lim = 7.24·r^0.205/f^0.356 cells, worst residual 5.4 %. Deliberately not classic
        Zener's r/f (a 3D rigid-boundary derivation) and not Srolovitz 1984's T = 0 2D Potts
        r/√f: this model anneals at kT = 0.6, where thermal flips detach boundaries from small
        obstacles (the weak r-exponent), and its count-weighted census reads the whole pinned
        population. Confounds ruled out by measurement before shipping: d₀-flooring (a fine
        cast with d₀ 10.6 plateaus within 5 % of the coarse cast's limit — start-structure
        memory is real, small, and inside the gate tolerance) and plateau creep (the f = 0.03
        arm run to 9 500 sweeps moved 0.26 % over its last 2 500). The r-lever looked dead at
        r = 2→3 (1.05×) and real at r = 1→5 (1.43×) — a short lever reads as no effect, the
        same knife-edge family as the exponent-fit lessons.
      - **Panel**: two dials appended AFTER the three the gates drive positionally (dispersion
        vol %, particle radius in cells with the µm equivalent printed); the note pre-judges
        with the measured law and clips the spec verdict's endpoint to min(law, d_lim); the
        dispersion latches at the pour with the spec; the card's pinned row prints the law by
        name. In the VOLUME the dials work but the note and card decline to print a d_lim —
        the mechanism is shared, the law is only measured in the plane, and borrowing a fit
        across a dimension change is how M_MODEL_3D earned its own constant. Share: the ht
        tuple grew the optional tail [t, min, spec, f?, rCells?]; the applier accepts 3 or 5,
        whole-rejection stance kept.
      - **Gates** (all green, three suite-runs deep): GG-PIN-OFF-IDENTITY (same-binary arms,
        full-field exact, 103 336 flips each, identical; pinned arm differs and flips fewer;
        GG-KMC continuity is the pre-C2 anchor), GG-PIN-LIMIT (three ladders on the law within
        8 %, plateaued, f-ordered, 0.37× the unpinned contrast), PIN3-LIVE (wall guarantee: 0
        fabric flips of ~30 000 against a JS hash-replica fabric, fabric nonempty at 9 %),
        HT-PIN-PANEL (surface wiring incl. the dPred first-arrow hazard), HT-ZENER +
        PIN-STRUCTURE (browser-free, CI: law arithmetic + the anneal-shaders-read-no-particle
        invariant), HT-DOC-CONSTANTS extended (science must quote the measured triple; the
        absolute "grain growth is unpinned" is a banned stale claim in all three documents).
      - **Postmortem — the gate that asserted a proxy.** PIN3-LIVE's first cut demanded the
        pinned arm flip FEWER cells than a plain arm and failed on a correct build: excluding
        particle cells from the energy sum flattens the local landscape (flat moves are always
        taken), so at 10 % coverage the extra flat moves near particle surfaces outweigh the
        migration suppression over a short window — the flip count is not monotone in pinning.
        The rewrite asserts what the mask construction actually guarantees (a fabric cell can
        never change id), checked against an exact JS replica of the WGSL hash (Math.imul wraps
        identically; a ≤50-flip tolerance covers the f32-vs-f64 threshold boundary, measured
        0). Same family as the wrong-comparison ledger: the assertion must be the mechanism's
        own invariant, not a directional proxy that usually co-occurs with it.
      - Two gate self-catches before shipping: PIN-STRUCTURE's "anneal shaders are
        particle-free" regex matched the shared HT struct DECLARATION in every shader
        (the invariant is a READ — `H.pinF` — not the field's existence), and
        HT-DOC-CONSTANTS' ban on "grain growth is unpinned" matched the new honest sentence
        ("unpinned by default") until a lookahead excluded it — both the vacuous-window class
        from C0c, caught by running the gate against both arms before trusting it.
      - Flake ledger, one run each on identical trees: GG3-KMC's r² printed 0.98473 against
        its 0.985 floor once (historical band 0.993–0.997; the cast3 freeze loop stops on a
        stats-poll threshold, so upstream wall-clock shifts move the cast — the documented
        wobble, green on re-run at 0.99481 and 0.99119), and REFINE-FAIR's 600-site arm read
        376 vs 319 grains once (its casts ride the page-load seed; green on re-run at
        371/366). Neither is C2's doing — the mask changes touch only anneal eligibility.
      - **Adversarial review before commit (5 lenses → 28 findings; 14 skeptic-judged: 9
        confirmed, 5 refuted; the unjudged tail hand-triaged to 7 more).** The blocker was a
        self-reference: TESTING.md's description of the new stale-claim ban QUOTED the banned
        phrase verbatim, so the doc gate failed on the tree that introduced it — reworded, and
        recorded as the class a text gate has to survive. The real ones: PIN-STRUCTURE checked
        that the particle test EXISTS, not that the mask CALLS it (dead text satisfied every
        regex — now `&& !inParticle(` and the salt's call-site are asserted, and the negative
        anneal check gained a positive liveness anchor so a renamed export cannot make it
        vacuous); HT-PIN-PANEL asserted the first arrow exists rather than that it is UNCHANGED
        from the unpinned note (now captured before pinning and compared); endUm() had no d₀
        floor, so a fabric finer than the casting predicted grain REFINEMENT through an anneal
        (floored, with a pinNote branch that says the furnace stalls where it stands); the
        stress-relief note was silent about a latched dispersion the card would then print; the
        contrast comment said "matched sweeps" with a stale 0.34 where the horizons differ by
        design and the measurement is 0.37; the printed formula equated a µm value to a
        CELLS-valued law with no unit at four sites (" cells" appended); and the claimed
        "three-element pre-C2 link still restores" had no gate (HT-SHARE-PRE-C2 added). From
        the tail: setup() now packs the pre-C2 3-tuple whenever the dispersion is off (old
        links and old pages keep working; the tail appears exactly when the mode is in use);
        the dispersion resets with the spec on every panel open; a restored fraction snaps to
        the dial step (a hand-built 0.0004 would have pinned the run while printing
        "0.0 vol %"); the coverage comment's "overlap makes it slightly less" was wrong in
        sign at small r (the Gauss-circle count makes r = 1 cover 5 cells against π·1² — the
        law is a law in the DIALLED numbers and absorbs it, which is now what the comment
        says); and the science page's "bit-identical to the pre-C2 anneal" was restated as
        what the two gates actually prove (same-binary call-shape identity + the standing
        GG-KMC drift anchor).

## v7.1 — THE PHASE DIAGRAM (2026-08-15)

Plan: this block. Written from four read-only survey agents (repo surface · data sources · alloy-design rules · repo doctrine) and then put through two independent adversarial planning passes before any code, the same shape that worked for Phase D. Between them the passes changed sixteen decisions, six of which changed the shape of the arc; those six are named at the end of this preamble and the rest are recorded at their own milestones.

Three asks arrived together. (1) More scientific accuracy about how alloy composition changes what happens. (2) Let the composer build an alloy from the full periodic table, "that adhere to alloy design of course". (3) S. Cai's review note: show the differing phases that appear, using phase diagrams. This arc answers all three without touching a solver kernel, and the honest version of ask (2) is not what it sounds like — the periodic table opens as a **picker**, not as a coefficient set. Every element is selectable; a pair with no cited liquidus slope and no cited invariant refuses by name and says which number is missing. There is no ESTIMATED tier anywhere in the shipped code. A pair is ASSESSED — meaning it carries a cited coefficient row in `BASES` **and** a cited invariant row in `phasedata.ts` — or it is refused. That single commitment is what makes an open picker safe, and it is the strongest thing in this plan.

The ceiling does not move and no milestone below moves it. `sim.ts` / `sim3d.ts` remain a dilute pseudo-binary Warren–Boettinger / Echebarria–Folch–Karma–Plapp model: **one solute field, one solid phase**. The chemistry channel to the GPU stays exactly five scalars — `alloyOn` (u32) and `c0, mLiq, kPart, dSol` (f32) at uniform slots 24–28 (`shaders.ts:44`, `sim.ts:521-522`). Nothing in this arc claims a uniform slot, adds a φ field, or changes the stats readback. Everything the phase diagram shows below the liquidus — the eutectic included — is a phase the casting beside it will never grow, and the panel says so on the same screen, not only on the science page.

**Data decision: baked, hand-entered, per-row-cited TypeScript in `src/phasedata.ts`.** No fetch, no vendored database, no Python in the build, no licence entanglement. Live fetch was probed on 2026-08-15 with an explicit `Origin: https://solidify.frankcai.dev` header and is dead: Materials Project OPTIMADE and AFLOW OPTIMADE both return 200 with **no** `Access-Control-Allow-Origin` (browser-blocked), OQMD returned 502, JARVIS 301; the three CORS-clean providers (NOMAD, Alexandria, odbx) serve crystal structures and 0 K DFT energetics and the OPTIMADE schema has no liquidus, solidus, invariant or temperature field in it at all. MP additionally needs an API key a static site cannot hold and forbids scraping. `src/` has zero runtime `fetch()` today and keeps it. The ~25 invariant rows are numeric facts read from published binary diagrams (ASM Handbook Vol. 3 / Massalski, *Binary Alloy Phase Diagrams*), cited per row in the `materials.ts:67` idiom that already sources Γ, ε₄, the Murr 1975 stacking-fault energies and the Ransley–Neufeld hydrogen solubilities. Facts are not copyrightable expression and no figure is reproduced — the app draws its own from the numbers, which sidesteps the whole image-licensing problem "phase diagrams online" would otherwise walk into. `docs/PHASE-AUDIT.md` names, per row, the open database that reproduces it offline (MatCalc mc_al v2.035 / mc_fe v2.061 / mc_ni v2.033, ODbL 1.0 + DbCL 1.0 with the notice embedded in each TDB header, TU Wien, Povoden-Karadeniz & Jacob; NIST `solders.tdb`, Kattner, US Government work under 17 U.S.C. §105) through pycalphad 0.11.2 (MIT) — and flags per row whether that reproduction was **actually run** or merely available. The repo vendors none of them, so ODbL §4.4a share-alike never attaches to the shipped bundle and the repo stays single-licence.

**Slot: after C3a, before Q3, before D3.** The gate-shape argument is the same one the v7.0 header makes for Q3 before D3. Q3's entire value is PASSSPLIT3, a bit-exact zero-physics-change refactor gate in the volume, and a bit-exact baseline only means something if the solver's inputs are frozen while it is taken. P1 changes what `calibrate()` receives, which moves ΔT₀ and therefore W₀, τ₀, dx, dt, µm-per-cell and every calibrated trajectory; P3 changes which compositions are reachable at all. Land either after Q3 and every Q3 baseline must be re-measured against a moved calibration — a bit-exact gate re-baselined to absorb the change it was meant to detect is a gate that has been told the answer. Calibrate once, then port. Against C3a there is **no** gate reason in either direction: C3a lives in the solid-state Potts layer and shares no state with the composer, the calibration or the phase table. What is forced is that they do not interleave — this arc perturbs CALIB-BAND and REFINE-FAIR while C3a perturbs the GG/PIN family, and a suite failure in a shared window would have two unrelated candidate causes. Where the order is free it is decided by the ask, and C3a is already queued. D3 stays last for its existing reason. **Tripwire, to be re-checked at the head of every milestone and not once at the start:** this arc touches `src/alloy.ts`, `src/composer.ts`, `src/quant.ts`'s input struct, `src/main.ts`'s `applyAlloy`/`calibrateNow`/`setMaterial`, new `src/phasedata.ts` / `src/phasediagram.ts` / `src/elements.ts`, `src/tour.ts` and the docs. It touches no WGSL, no uniform slot, no stats layout. If any part of it ever grows a second φ field, claims a uniform slot or changes the readback, that part leaves the arc and lands after Q3 for exactly the reason D3 does.

**What the adversarial pass changed, in order of consequence.** (1) *The data milestone now leads and the calibration fix comes second.* The original plan's headline — feed the poured mix's own |m| and k into `referenceInterval` — cannot be done correctly without C_SM and T_inv, because ΔT₀ = |m|c∞(1−k)/k is the freezing range of a *single-phase* dilute alloy and is only valid for c∞ ≤ C_SM. A356 sits at 7 wt% Si against C_SM ≈ 1.65 wt%. Applied naively it moves the reported freezing range from wrong-by-2× to wrong-by-5×, in the wrong direction, and strips off the `materials.ts:67` "Al–4Cu" source sentence that at least labelled the old number as a stand-in. (2) *`kEff` refuses instead of clamping.* Measured on the shipped tree: A356+TiB gives Q = 71.19 K against depression 44.686 K, so 1 − Q/depression = **−0.593**. `referenceInterval` (`quant.ts:114`) clamps k to [1e-3, 0.999] and `calibrate()` has no `dT0 > 0` guard, so an unclamped kEff would produce a negative ΔT₀, a negative `latent` assigned straight into `sim.params` at `main.ts:211-223`, and a thermometer reading `249.2/0.05` through `units.ts`'s `Math.max(0.05, latent)`. That mix is the landing page's own CTA (`index.html:485`) and one of REFINE-FAIR's two arms. (3) *The Scheil formula was inverted.* Gulliver–Scheil gives f_E = (C_inv/c0)^{1/(k−1)}, not 1 minus that; the plan's version made lever ≤ Scheil fail on its own flagship example by 0.002 and asserted a zero eutectic fraction at C_SM where the true value is ~10 %. (4) *`source` on `Solute` lands with the data, not with the picker.* `grep -c "source:" src/alloy.ts` returns 0 — not one of the 25 shipped pairs carries a citation, so "ASSESSED means both tables cite it" would have referenced a field that does not exist. (5) *The tour stops driving the composer DOM.* `#composer` is `position:fixed; z-index:30` with a backdrop whose `pointerdown` closes it (`composer.ts:74`), `#tour` has no z-index, and `TourHost` (`tour.ts:194-202`) has no composer handle — a GPU gate that cannot be driven is worse than no gate. (6) *ALLOY-NO-DEAD-KNOB's metric was replaced.* Measured: `derive({base:'al',wt:{}})` → `derive({base:'al',wt:{Ti:0.075}})` moves |Δc0|+|ΔmLiq|+|ΔkPart| by **0.0000 exactly**, because `c0 = min(0.7, max(0.05, totalWt/15))` pins c0 at its floor below 0.75 wt% and a liquidus-raising solute leaves `depression = 0` so kRaw takes the 0.9 fallback. The gate would have gone red for correct reasons on the app's most famous grain refiner.

---

- [x] **P0 — the cited invariant table lands, and the 25 shipped coefficients get their first provenance.**
      This is the milestone the rest of the arc stands on, and it buys an unearned bonus: entering invariants gives an independent second route to coefficients `alloy.ts` currently asserts from memory. Landed alone so a failure in the P2 window is in the wiring, not in the data. No UI, no solver change.
      - **New `src/phasedata.ts`.** `BINARY: Record<baseKey, Record<element, BinaryRow>>` with `BinaryRow = { invariant: "eutectic" | "peritectic" | "isomorphous" | null, Tinv: number|null (°C), Cinv: number|null (wt%), Csm: number|null (wt%), second: string, source: string }`, one row per currently shipped (base, solute) pair (25 to start), plus exported `PHASE_TABLE_VERSION`. Isomorphous systems (Cu–Ni, and Fe–Ni on the γ side) carry `invariant: null` with null Tinv/Cinv/Csm and an **empty** `second` — there is no second phase to name and a filled field there would be an invention. Fe–C's row is the **δ-ferrite peritectic** (L + δ → γ, 1495 °C, C_inv 0.53 wt%, C_SM(δ) ≈ 0.09 wt%), not the 1147 °C eutectic; entering the wrong one would sail through every gate here and silently move P3's ceiling, so it is called out in that row's own source string.
      - **`Solute` gains `source: string`, and all 25 rows are filled in this same transcription session.** Today the only provenance is a file-header sentence ("approximate textbook dilute-limit binary coefficients, Kurz & Fisher-style"). Per-pair sources are what make the P5 tier function honest, and they are cheap to write while the diagrams are already open. In the same commit, reconcile Al–Cu: `alloy.ts` ships `k = 0.15` for the Cu-in-Al pair while `materials.ts:61` ships `si.kPart = 0.17` for the same physical system. Pick one, cite it, and say in the source string why the other was retired. (`MATERIALS.al.params.kPart = 0.14` is the dimensionless model knob and is a different quantity — leave it alone, it anchors CALIB-BAND.)
      - **The construction is a cross-check, never a source.** m̂ = (T_base − T_inv)/C_inv and k̂ = C_SM/C_inv reconstruct the dilute chord from three diagram numbers. Nothing it produces ships. Its 4 %/13 % agreement quoted in the survey was measured over a **self-selected seven systems** and does not survive the full predicate set — Zn–Al, Ni–Nb and Ni–Cr are all expected to land 1.3–1.6× out. So the gate below is a **per-row drift tripwire with every ratio recorded**, not a global tolerance, and it is not sold as more than that.
      - **Gates.** `PD-ROW-SOURCED` (browser-free) — totality and both polarities: every row's `source` > 30 chars; the DISTINCT source set size ≥ 5 so one blanket citation pasted 25 times fails (the HT-REFUSE set-size trick); every non-isomorphous row has a non-empty `second`; every isomorphous row has an empty one; every `BASES` (base, solute) pair resolves to a row and every row resolves to a pair, so neither table can drift ahead of the other; every `Solute` now carries a `source` > 30 chars with its own distinct-set check. `PD-CONSTRUCT-AGREE` (browser-free) — for every row passing the asserted predicate (`invariant === "eutectic"` **and** `Cinv ≤ 60 wt%`), m̂/m and k̂/k are computed and compared against **a per-row baseline table measured on this tree first and written into this ledger with every ratio before anything is pinned**. Three liveness clauses, the third load-bearing: ≥ 7 rows entered the comparison; ≥ 1 row was EXCLUDED by the predicate (a predicate that silently matched everything cannot pass); and the anti-derivation clause — the ratios are NOT all exactly 1.0, because if they were, `phasedata.ts` was generated from `alloy.ts` and the gate is comparing a table with itself. Rows whose ratio exceeds a disagreement threshold **to be set after the full ratio set is measured** are recorded as NAMED DISAGREEMENTS in this ledger and printed in `docs/PHASE-AUDIT.md` ("the shipped slope for Nb in Ni is 10.5 K/wt%; the invariant chord gives ~5.5, and this instrument has not resolved which is right") rather than being swallowed by a widened band. `PD-VANTHOFF-CROSSCHECK` (browser-free) — a third opinion as a transcription tripwire only, never an estimator: for rows with k ≤ 0.2, the ideal-liquid product |m_at|(1−k) against R·T_m²/ΔH_fus from the shipped `MaterialSI`, with the band measured first. Scoped to k ≤ 0.2 because over 14 shipped systems the ratio spans 0.04–1.69, a 40× range, and it is near-exact only where the solute is strongly rejected. **Liveness clause size to be set after counting how many per-pair rows actually have k ≤ 0.2** — do not write "≥ 4" before counting; the presets are not the pairs.
      - **Risks.** Hand transcription is the whole risk; the four defences are the anti-derivation clause, the van 't Hoff opinion, the distinct-source set size, and `docs/PHASE-AUDIT.md` making every row independently checkable. Peritectic and far-invariant rows (Cu–Sn, Cu–Zn, Al–Ti, Mg–Zr, Al–Zn) fail the construction by design and must be excluded by the **asserted** predicate, never silently skipped — a skipped row is the vacuous-gate class that bit POR-PORE-SOLUTE and PIN-STRUCTURE. `scripts/*.mjs` sit outside `tsconfig.json`'s include, so `tsc` cannot see a missing field in a gate's setup literal; adding `source` to `Solute` means grepping every `.mjs` literal, not assuming there is one (v6.2 found all four by grep).
      - **Docs.** New `scripts/verify-phasedata.mjs` registered in `scripts/run-tests.mjs`'s browser-free block, in `.github/workflows/ci.yml`, and in `TESTING.md` under "What each script checks" — and `TESTING.md`'s browser-free count is stated in three places (lines 25, 41, 469) against exactly seven `- run: node scripts/verify-*.mjs` lines; all three move in this commit or the doc drifts the way C0b's did. New `docs/PHASE-AUDIT.md`. `README.md`'s "coefficients … per element" phrasing is corrected — m and k are per **pair** (Al carries three different pairs across the Ni, Mg and Zn bases; Ti flips sign between Al and Ni).

      - **DONE 2026-08-15. Every one of the 25 rows was independently recomputed before it
        shipped** — Frank's call when asked whether to run the reproduction now or ship the flag
        honest and backfill. It changed the milestone: the audit is no longer a promise in
        `docs/PHASE-AUDIT.md`, it is 25 computed rows sitting beside the 25 cited ones, and four
        of them are NAMED DISAGREEMENTS that a hand transcription would have shipped silently.
      - **The stack.** pycalphad 0.11.2 (MIT) on Python 3.12.10 against MatCalc `mc_al v2.037`,
        `mc_fe v2.062`, `mc_ni v2.036` (ODbL 1.0 + DbCL 1.0, notice embedded in each file
        header) and NIST `NIST-solder.tdb` (Kattner, US Government work). **The plan's version
        numbers were stale** — it cited v2.035/v2.061/v2.033; the live files are newer and their
        changelogs include a March 2025 Al–Cu reassessment, one of the audited systems. The
        audit cites what was actually run. No database is vendored, so ODbL §4.4a share-alike
        never attaches and the repo stays single-licence; `scripts/phase-audit/` carries the
        tooling and fetches the four files by URL. Nothing in `src/` gained a `fetch()`.
      - **The measurement corrected itself four times, and every correction has the same shape:
        the answer was being read off the WINDOW rather than off the physics.**
        (1) Dropping MatCalc's `ATTACH_CONTRIBUTION` leaves `GP_MAT` without its FCC_A1
        order/disorder contribution, so it goes spuriously stable and **the Al–Si eutectic came
        out at 604 °C with GP_MAT as the primary phase at 51 wt% Si**, against a known 577 °C
        and 1.65 wt%. Fixed by suspending MatCalc's precipitation-kinetics phases (GP zones,
        clusters, prime and double-prime transition precipitates) — which is what MatCalc itself
        does for an equilibrium calculation.
        (2) Locating the invariant as a **plateau in the solidus** reproduces Al–Si and fails
        Fe–C twice over: compositions whose liquid survives to the bottom of the scan window all
        report that floor and collectively fake a plateau there, and the true δ-peritectic
        plateau spans only 0.09–0.17 wt% C, which a uniform composition ladder resolves with two
        points. Replaced by **the composition at which the first-forming solid changes
        identity**, which is the definition of a binary invariant and reads eutectics and
        peritectics through one code path.
        (3) "Primary phase" read at the bottom of the temperature range returns **austenite**
        for Fe–C, because γ is what is stable at 1427 °C — but the phase that freezes out of the
        melt is δ-ferrite, and the peritectic being searched for is the one that consumes it.
        Primary is now read AT the dilute liquidus.
        (4) "Second phase" read from BELOW the isotherm returns nothing for a peritectic, since
        in L + β → α the reacting phase β lives above it and is gone below — which is why Al–Ti,
        Mg–Zr and Fe–Mo all first came back `second: null` with an undecidable type. It is now
        the first-forming solid just ABOVE the invariant composition, which is exactly what the
        changeover search already located.
      - **And once by suspecting the check, per the standing lesson.** A per-command TDB parse
        check reported **456 unparseable commands** in mc_al. All false: pycalphad joins
        continuation lines before parsing and the checker fed them raw, so every multi-line
        `FUNCTION` read as an indentation error. Normalised, the real count is **17 across three
        files, and they are genuine typographical errors in the PUBLISHED databases** —
        `6000.00.00` as a temperature limit, `G(G_PHASE;…` with a semicolon where the phase-name
        comma belongs, two `PARAMETER` commands merged by a missing `!`, trailing junk on a
        constituent line — each repaired by an explicit recorded rule, plus two Pd–Mn parameters
        that cannot be unambiguously repaired and are dropped by name.
      - **Validated against known answers before any row was trusted**, and these are not inputs
        to the calculation: **Al–Si 577.1 °C / 12.51 / 1.567 wt%** (known 577 / 12.6 / 1.65),
        **Al–Cu 553.4 / 32.27 / 5.484** (known 548.2 / 33.2 / 5.65), **Fe–C 1494.6 / 0.528 /
        0.092** (known 1495 / 0.53 / 0.09). Fe–C is the strongest result in the audit: the right
        invariant — the δ peritectic, not the 1147 °C cementite eutectic — to 0.4 K and 0.4 %,
        on a system whose primary phase exists over only a 144 K window.
      - **Result over 25 rows: 16 agree · 2 agree by BOTH finding no invariant · 3 reaction
        types decided by hand · 4 named disagreements · 1 not resolved.** The two negatives are
        load-bearing: Fe–Cr and Cu–Ni are isomorphous, and the search REFUSED to invent an
        invariant for either while the literature independently said the same thing. `zn-Al`
        reads 380.9 °C / 5.16 / 1.295 against a cited 381 / 5 / 1.17, and `al-Zn` — the same
        physical invariant read from the other end of the diagram — 380.9 / 94.84 / 83.29
        against 381 / 95 / 83.1.
      - **The four named disagreements, recorded rather than averaged.** `ni-Nb` differs by
        **80 K** (cited 1282 °C / 21.6 wt%, computed 1362 / 27.24) on the same reaction and the
        same δ-Ni3Nb second phase — both internally consistent, and **this instrument has not
        resolved which is right**. `mg-Zr` has **no reliable open reproduction path**: mc_al is
        an aluminium database, its Mg–Zr binary returns an α-Mn-structured second phase where
        the accepted diagram has (α-Zr), and thirteen targeted probes on both sides of the
        isotherm found no two-phase field to read C_SM from at all. `fe-Ni` and `mg-Al` carry
        their provenance weaknesses named. `fe-Si` is **not resolved** after three widening
        passes: mc_fe models the ordered B2/D0₃ Fe–Si field as part of BCC_A2, so no phase
        IDENTITY change occurs at the boundary this method looks for — a method tracking
        ordering would find it, this one does not, and the audit says so rather than widening
        until something appeared.
      - **Al–Cu's k was double-valued and the chord settled it.** `alloy.ts` shipped 0.15 and
        `materials.ts` `si.kPart` 0.17 for the same physical system. C_SM/C_inv = 5.65/33.2 =
        **0.170**, so the invariant chord independently reconstructs the materials.ts value and
        0.15 was the outlier. Reconciled to 0.17, with the retired value named in the new source
        string. `MATERIALS.al.params.kPart = 0.14` is the dimensionless model knob, a different
        quantity, and is untouched — CALIB-BAND is anchored on it.
      - **The chord cross-check is a per-row tripwire and cannot be a band, and that is now
        measured rather than asserted.** Across all 22 non-isomorphous pairs, m̂ = (T_inv −
        T_base)/C_inv and k̂ = C_SM/C_inv reconstruct the shipped coefficients within 25 % on
        BOTH m and k for **12 of 22**: Al–Cu, Al–Si, Al–Mg, Al–Fe, Al–Ti, Fe–C, Fe–Mn, Fe–Mo,
        Ni–Mo, Mg–Al, Mg–Zn, Cu–Zn. Al–Si lands 1.00, Fe–C 1.04/1.00, Mg–Zn 1.00/1.00, Al–Ti
        1.02/0.98. The misses are PHYSICS, not error: Cu–Sn 1.52/3.30, Al–Zn 1.84/1.99, Fe–Si
        2.32/1.78, Zn–Al 1.57/2.34 — every one an invariant sitting far from the dilute limit,
        where a chord drawn across the whole diagram is simply not the dilute slope.
        **`materials.ts:127` already said exactly this about Cu–Sn, before it was measured
        here.** A single global tolerance would either redden correct rows or be wide enough to
        assert nothing, so each pair's `source` carries its own ratio and its own verdict.
      - **Gates.** `scripts/verify-phasedata.mjs`, five checks, browser-free, joining `npm test`
        and the CI set as its **eighth** member. `PD-ROW-SOURCED` — every row sourced >30 chars
        AND ≥5 distinct strings, so one blanket citation pasted 25 times fails (the HT-REFUSE
        set-size trick). `PD-SECOND-PHASE-POLARITY` — invariant rows must NAME phase and
        reaction, isomorphous rows must leave both empty with null numbers; both directions, and
        both branches asserted non-empty so a table with no isomorphous systems cannot pass
        vacuously. `PD-TABLE-BIJECTION` — BASES ↔ BINARY in step in both directions, so neither
        table can drift ahead of the other. `PD-ORDERING` — every row obeys its own reaction's
        geometry (C_SM < C_inv for a base-rich eutectic: the likeliest hand-entry error, and one
        no amount of sourcing would catch), with ≥1 eutectic and ≥1 peritectic required present.
        `PD-SOLUTE-SOURCED` — the same distinct-set check over alloy.ts's 25 coefficient rows.
        **All five were run against the PRE-change tree first and all five FAILED there with
        exit code 1** — the vacuous-gate check this repo has now paid for three times.
      - **Two self-catches before the commit.** `PD-SECOND-PHASE-POLARITY` went red on `ni-Al`
        because the hand-decided type override had cleared its reaction string: the gate caught
        its own milestone's defect. And the first `alloy.ts` rewrite reached only 23 of 25 pairs
        — `fe C` and `ni W` are written `C:  {` and `W:  {` with two spaces for column
        alignment, which the rewrite regex missed. Both counts are asserted by the gates, which
        is why neither could ship.
      - **Nothing the existing gates pin moved.** All seven pre-existing browser-free gates
        green after the Al–Cu change — it touches no preset containing copper (A356+TiB, 1045,
        4340 and the lean-Al arms are Cu-free, so REFINE-FAIR's two arms and the four
        doc-quoted `derive()` outputs are untouched). `npm run typecheck` and `npm run build`
        both clean.
      - **Docs.** New `docs/PHASE-AUDIT.md` — databases and licences, every transformation
        applied to the source files, the method and each of its four corrections, the validation
        table, the 25-row comparison, and the reproduction recipe. New `scripts/phase-audit/`
        with the tooling and a README stating plainly why it is NOT in CI (it needs Python,
        pycalphad and a network fetch; the shipped cross-check is browser-free JS for exactly
        that reason). `TESTING.md` seven → **eight** in all three places, against exactly eight
        `- run: node scripts/verify-*.mjs` lines in `ci.yml`, plus a `verify-phasedata.mjs`
        entry. `README.md`'s "partition k per element" corrected — m and k are per **pair**;
        aluminium is a solute under three different bases with three different coefficients, and
        titanium changes sign between Al and Ni.
      - **Still owed by this arc, and not silently dropped:** `PD-CONSTRUCT-AGREE` and
        `PD-VANTHOFF-CROSSCHECK` are specified above but are NOT yet written as gates. The ratio
        set they need is measured and recorded here, which is the order the plan demanded —
        measure first, then pin. They land with P1, whose `Derived` changes touch the same
        arithmetic.

- [x] **P1 — the calibration learns the alloy it was actually poured, refuses when the mix has no freezing range, and the six silent drops start refusing by name.**
      A live scientific defect, not a feature. `quant.ts:112-116` builds ΔT₀ from the MATERIAL's `si.mL`/`si.kPart`, and for base `al` those are −3.4 / 0.17, which `materials.ts:67` says out loud are Al–4Cu. Pour A356 and the kelvin-per-unit, W₀, τ₀, µm-per-cell and every SI readout downstream are computed for a different alloy. The composer already computes the right |m| and k and prints them on screen; they are simply not wired.
      - **ΔT₀ is regime-aware, because the dilute formula stops being valid at C_SM.** `Derived` gains `mSI` (wt%-weighted dilute slope, K/wt%), `kEff` and `dT0` beside the existing clamped `mLiq`/`kPart`. `QuantInput` gains optional `mL`/`kPart`/`dTinv` overrides; `referenceInterval` prefers them and falls back to `si.mL`/`si.kPart` **unchanged** when absent, so every existing caller is bit-identical. For c∞ ≤ C_SM it keeps |m|c∞(1−k)/k. For c∞ > C_SM it returns the **truncated interval** ΔT₀ = T_L − T_inv, because the alloy freezes from its own liquidus down to the invariant isotherm and no further: for A356 that is (660.35 °C from `si.Tm = 933.5 K`) − 48.4 K of depression − 577 °C (Al–Si eutectic, ASM Vol. 3) ≈ 35 K, against a published A356 freezing range of ~60 K (615→555 °C) and against the 122 K the shipped Al–4Cu stand-in produces today. **The exact shipped value and its agreement with the published range are to be measured by the gate on this tree and recorded here before any tolerance is written.** Where no `phasedata` row exists for the dominant solute, the poured-mix override is refused by name and the material's own numbers are used, with `QuantSetup.coefficientSource` saying which.
      - **A peritectic-dominated mix has no dilute freezing range, and the calibration says so instead of printing one.** Measured on the shipped tree, A356+TiB gives ΔT_L = −44.686 K, Q = 71.1913 K and kEff = 1 − 71.1913/44.686 = **−0.59315** (`alloy.ts:170` clamps it to the 0.12 floor today). **A correction to this plan, made while verifying it against the tree before it was written down:** the planning pass also quoted Mg–0.8Zr at −4.50 and Al–0.5Ti at −7.0, and both numbers are wrong under the definition this milestone commits to. They are `1 − Q/|ΔT_L|`, not `1 − Q/depression`. Zr and Ti *raise* the liquidus (m = +6.9 and +30.7), so ΔT_L = +5.52 K and +15.35 K, `depression = max(0, −dTL)` is **exactly 0** for both, and `kRaw` never evaluates — it takes the 0.9 fallback at `alloy.ts:169`. Those two mixes therefore trip the **`depression ≤ 0`** clause, not the `kEff ≤ 0` clause, and CALIB-MIX-REFUSE must assert **which clause fired**, not merely that something refused — a refusal that names the wrong mechanism is a wrong statement rather than an absent one, which is the standard EL-TIER-TOTAL is already held to. Recorded here rather than silently repaired because it is the third instance in this repo of a number that was written before it was measured, and the first one caught by re-deriving a planning claim against the tree before the milestone opened. `calibrate()` gains an explicit refusal — when `depression ≤ 0` or `kEff ≤ 0`, return the material-default calibration with a named warning ("Ti raises this melt's liquidus; a peritectic-dominated mix has no dilute freezing range and the calibrated thermometer declines to invent one"), never a negative ΔT₀. This is `heattreat.ts:531-534`'s doctrine one layer over, and it is the arc's best teaching line. `kEff` is defined on `derive()`'s own footing — `depression = max(0, −dTL)`, not |ΔT_L| — so the new field and the shipped clamp path agree about what "depression" means.
      - **The wiring is the milestone, not the arithmetic.** `applyAlloy` (`main.ts:843-862`) calls `setMaterial`, which does `Object.assign(sim.params, m.params)` (`main.ts:539`) — landing `MATERIALS.al`'s `latent 1.35` and `delta 0.045` over whatever `setSolver(QUANT)` computed at `main.ts:211-223` — and never re-enters `setSolver`. So pouring while calibrated already silently drops out of the calibration while `sim.params.solver` stays QUANT. That is a shipped defect and it gets its own postmortem line. Fix: `applyAlloy` re-enters `setSolver(SOLVER.QUANT, currentLambda)` when the solver is QUANT. A module-level `pouredMix | null` is set by `applyAlloy`, read by `calibrateNow` (`main.ts:177`), and **cleared by `setMaterial`**, because picking a material is not pouring an alloy.
      - **The six silent drops start refusing by name.** `Derived` gains `refusals: string[]`; each site pushes a named string instead of vanishing: `derive()`'s unknown-element filter (`alloy.ts:139`), `Composer.render()`'s silent delete (`composer.ts:105`), `decodeMix`'s two `continue`s (`alloy.ts:199,201`), `setMaterial`'s silent return on an unknown key (`main.ts:535-536`), and the 3D `if (k in P)` drop (`main.ts:849`). `applyAlloy` stops overwriting `alloyName` when `setMaterial` refused — today a composed name is printed over the previous material's still-live thermometer, clock, Γ, ε₄ and heat-treat laws. Refusals and clamps render **outside** the modal: beside the alloy name (`ui.ts:874`) and on the heat-treat card (`heatpanel.ts:432`), so an `#alloy=` deep link carries its own caveats — `science/index.html:122`'s claim that the app "labels every clamp it has to make" is currently true only inside the composer.
      - **Gates.** `ALLOY-SUMS-EXACT` (browser-free) — the superposition's own algebra to 1e-12 over all 9 FAMOUS presets and all 25 pairs, recomputed **inside the gate from `BASES`** against `derive()`'s outputs: ΔT_L = Σ m_i c_i, Q = Σ m_i c_i(k_i − 1), and the wt%↔at% round-trip through the base-inclusive mole balance with `molBase = (100 − totalWt)/base.mass` asserted strictly positive (`alloy.ts:151` has no guard and goes negative past 100 wt%). Deliberately **not** "k_eff = 1 − Q/|ΔT_L|" — that identity is false against the shipped `kPart` for A356+TiB (0.120 vs −0.593) and galv. bath, because `kRaw` is clamped at `alloy.ts:170`, and checked against the new `kEff` field it would assert a definition against itself. Deliberately **not** "ΔT₀ ≥ Q", which is false for any k > 1 solute. Liveness: ≥ 30 cases entered, every value finite, and the kEff spread across the 9 presets exceeds a floor measured first — a collapse returning one constant for every alloy would satisfy every identity above. `ALLOY-CLAMP-REPORT` (browser-free) — for each preset, which of the four shipped clamps fired and on which bound, asserted against a recorded table. This is a fact about the tree that no definition can satisfy trivially, and it is where the c0-floor finding lives: every addition below 0.75 wt% total is invisible to the solver's c0. `CALIB-MIX-OWN` (browser-free) — ΔT₀ from `calibrate()` with poured overrides equals an independent recomputation of the **regime-appropriate** formula inside the gate, to 1e-9; plus the mechanism assertion ΔT₀ ≤ T_L − T_inv for every hypoeutectic preset; plus A356 pinned against the published 60 K freezing range with the tolerance measured first. Not "A356 differs from Al–4Cu" — two different wrong numbers also differ. `CALIB-MIX-REFUSE` (browser-free) — drives A356+TiB, Mg–0.8Zr and Al–0.5Ti, asserts the refusal fires, names the offending solute, and that ΔT₀ is still finite and > 0; plus the positive polarity that plain A356 still calibrates. `CALIB-MIX-OFF-IDENTITY` (browser-free) — with no override, `calibrate()` returns `Object.is`-identical d0/W0/tau0/dTilde/dT0/latent/umPerCell/dx/dt against a verbatim pre-P1 reference for the **9** MATERIALS entries that carry an `si` block, and the other 2 (`generic`, `qc`) are asserted to return null **by name** — `grep -c 'si: {'` is 9 against 11 keys, and two nulls compare equal, which is exactly the failure `lessons.md:25-42` exists to prevent. `coefficientSource` is asserted non-empty and **different** between the two cases. `CALIB-POUR-WIRED` (GPU) — the wiring, not the arithmetic: pour A356 through `window.__solidify.composer` while calibrated, then assert `kelvinPerUnit` moved **and** `sim.params.latent === q.latent`. Without this arm the browser-free gates are green while the app's behaviour is unchanged — the U0 lesson quoted at `run-tests.mjs:38-40`. `ALLOY-REFUSE-NAMED` (browser-free) — each of the six drop sites driven with input that triggers it, emitting a refusal > 20 chars containing the offending symbol or key; the DISTINCT refusal count equals the number of sites driven; and an un-triggered control mix produces `refusals.length === 0` with a non-empty params bundle, so a function that always returns six strings also fails. `DEPR-CONSISTENT` (browser-free, informational first) — reports, per preset, the composer's printed ΔT_L against `u.kelvin(mLiq·c0)`, the number the solver actually integrates. Measured, 6 of 9 presets are clamped (1045 and 4340 sit on the mLiq 0.8 ceiling; A356+TiB and galv. bath on the k floor), so the two can disagree several-fold. This ships as a printed ratio table in this ledger first; it becomes an asserted band only once the spread is measured.
      - **Risks.** CALIB-BAND (`verify-quant.mjs:636-677`) derives its 1–15 K / 1–10 K bands from `WT_PER_C0 × MATERIALS.al.params.c0` = 4.5 wt%. It survives only because its setup calls `setMaterial('al')` before `setCalibrated(true)`, which now nulls `pouredMix` — assert that clear **explicitly** in the gate rather than relying on the call order of a gate written for another purpose. `WT_PER_C0`, `DEPR_CAP` and the mLiq/kPart clamps do not move in this arc. REFINE-FAIR (`verify-tools.mjs:529-568`) calls `derive()` and places both arms from `1 − mLiq·c0`; P1 adds fields and changes neither, so it should be untouched — but it is already logged flaky (376 vs 319 grains once) and both readings go in the flake ledger rather than being re-run away. `pouredMix` is a lifetime-bug surface `tsc` cannot see: pour → pick a material → enter calibrated mode must use the material's numbers, and that path gets its own arm.
      - **Docs.** `science/index.html` §10 gains the calibration row (what ΔT₀ is now built from, and that past C_SM it is the truncated interval to the invariant, not the extrapolated dilute solidus). `TESTING.md` gains the new gate names. `README.md` unchanged this milestone.

      - **DONE 2026-08-15.** `calibrateNow` now passes the poured mix's own reference interval
        into `calibrate()`, `setMaterial` clears the pour and refuses by name, `applyAlloy`
        re-enters `setSolver`, and eight of the nine shipped presets calibrate on their own
        chemistry instead of on `materials.ts`'s Al–4Cu / Fe–C / Cu–Sn stand-ins. Nine
        browser-free checks in a new `scripts/verify-alloy.mjs` plus one GPU arm.
      - **THE MILESTONE IN ONE TABLE.** ΔT₀ in kelvin, before → after, with the regime the
        change landed in. `today` is what the app printed on 2026-08-14 for the same pour.
        A356 122.0 → 303.4 (past-reference) · A356+TiB 124.0 → declined (k_eff −0.593) ·
        AA2024 97.9 → **56.5** (dilute) · 1045 552.2 → **129.0** (past-reference) ·
        4340 **1504.3 → 77.8** (past-reference) · IN718 108.1 → **65.3** (dilute) ·
        AZ91 114.0 → **120.9** (dilute) · tin bronze 148.6 → 310.8 (past-reference) ·
        galv. bath 5.6 → **8.8** (dilute). The four dilute rows are the ones with published
        numbers to check against and all four improve: IN718 65.3 against a published ~76 K,
        AZ91 120.9 against ~130 K. **4340 is the headline defect: the app was measuring one
        dimensionless degree as 1504 K**, because `si.mL` for steel is Fe–C's −78 K/wt% and
        `sim.params.c0` put 3.95 wt% of carbon-equivalent behind it.
      - **THE PLAN WAS WRONG ON PHYSICS HERE, NOT ON ARITHMETIC, AND IT TOOK THREE POSITIONS TO
        FIND OUT.** The milestone specified the truncated interval ΔT₀ = T_L − T_inv past the
        solubility limit. Position 1 (the plan) was implemented and measured: A356 → 35.0 K.
        Position 2 came from a literature check that was asked to argue BOTH sides and argued
        against it: **d₀ = Γ/ΔT₀ is not a thermal relation.** Writing Gibbs–Thomson in the
        Karma–Rappel supersaturation U = (c_l − c_ref)/[c_ref(1−k)] gives
        d₀ = Γ/[|m|(1−k)·c_ref], which collapses to Γ/ΔT₀ for exactly one choice,
        c_ref = c∞/k — the steady-state planar-front liquid, which is precisely the state that
        stops existing past the bound. Substituting any other interval re-picks c_ref without
        renormalising U, and d₀ carries into W₀, the cell pitch and the anti-trapping
        magnitude. Its proposed repair was to regauge onto c_ref = c∞, dropping the 1/k and
        leaving |m|c∞(1−k) — **which is exactly Q, the growth restriction factor this composer
        has printed since v5**, reached from the other end. Position 3 killed that too, and it
        came from this repo rather than from the literature: `shaders.ts` states above `uSup`
        that the reference state IS c_l⁰ = c∞/k, and says why — gauging on the liquidus
        instead "stretches the freezing range to 1/k ≈ 6 dimensionless degrees, which does not
        fit the solver's own [−1, 2] clamp". **The kernel is gauged on c∞/k.** Handing it a d₀
        built on any other reference would put a capillary length in front of a
        supersaturation the WGSL does not compute.
      - **So what shipped is the one thing all three positions agree on: the mix's OWN m and k,
        in the model's OWN gauge, with the gauge labelled when it is extrapolated.** Four
        regimes. `DILUTE` — the linearised solidus is still above the invariant, so c∞/k is a
        state the alloy reaches and ΔT₀ = |m|c∞(1−k)/k is a real freezing range.
        `ISOMORPHOUS` — no invariant exists to bound it. `PAST-REFERENCE` — same formula,
        flagged `EXTRAPOLATED GAUGE`, with c∞/k named, the invariant it has passed named, and
        **the alloy's real primary freezing range printed beside it with the ratio**: A356
        reads 303.4 K of model interval against 35.0 K of real primary freezing, a factor of
        8.7, stated rather than buried. `REFUSED` — nothing to compute.
      - **The alternative considered and rejected, recorded because it is the tempting one.**
        Refusing past the bound and falling back to the material default is worse, and worse in
        exactly the way this milestone exists to fix: A356's fallback is Al–4Cu's 122 K, which
        is the same invalid gauge applied to a **different alloy**. A number in the right gauge
        for the wrong alloy is not more honest than a number in an extrapolated gauge for the
        right one.
      - **THE BRANCH IS DECIDED IN TEMPERATURE, AND THAT CHOICE IS LOAD-BEARING.** The
        composition test c∞ ≤ C_SM and the temperature test T_S ≥ T_inv are the same statement
        only when the shipped dilute m and k reconstruct the invariant chord — which P0
        measured they do for 12 of 22 pairs and not for the other 10. For Al–Si the two
        separate: k·C_inv = 1.512 wt% against C_SM = 1.65 wt%. The temperature test uses the
        same m and k the solver integrates, so the branch and the arithmetic agree by
        construction even where the two tables do not. **The composition form was also checked
        for the branch-mismatch error it invites** — comparing the LIQUID composition c∞/k
        against the SOLID ceiling C_SM, which is too tight by 1/k (8.3x for Al–Si). It is not
        in the shipped code.
      - **A356's published freezing range is 40 K, not the 60 K this plan quoted, and the
        difference is equilibrium versus Scheil.** The 615/555 °C pair in every foundry
        datasheet is real but it is the **as-cast** range: at equilibrium A356's 0.35 wt% Mg
        stays in solid solution (the (Al)+(Si)+Mg₂Si three-phase field needs 0.83 wt% Mg at
        552 °C, Belov/Eskin/Aksenov Table 2.4), Mg₂Si never forms, and freezing ends on the
        Al–Si monovariant valley at roughly 573 °C — bracket 567–577 with the Fe that real
        A356 carries. Belov et al. say it outright at p.48: Mg₂Si "appears **only as a result
        of nonequilibrium ternary eutectic reaction at 555 °C**". So the equilibrium range is
        ~42 K (bracket 38–48) and the Scheil range is ~60 K, and the plan compared an
        equilibrium quantity against a non-equilibrium one. The shipped code's real primary
        range for A356 is 35.0 K against the strict binary end point's 38 K.
      - **A defect in P0's own provenance, found by a gate that was not looking for it.** The
        `fe-Cr` coefficient row's source ended "k > 1 here because the solute raises the
        liquidus". Chromium in iron has k = 0.95 and m = −1 K/wt%: **the clause is false on
        both halves**, and it is a verbatim copy of the Cu–Ni sentence one table over. Caught
        while measuring which pairs are isomorphous. Corrected, with the retired clause quoted
        in the replacement so the error is on the record rather than erased.
      - **A REGRESSION THIS CHANGE WOULD HAVE INTRODUCED, FOUND BY THE CALL-SITE SURVEY BEFORE
        IT SHIPPED.** `share.ts`'s `ShareState` carries `p/u/v/m/n` and no mix; `n` is a
        display name only. Before P1 a shared calibrated link recalibrated on the material
        default at both ends, so minter and recipient agreed. Once the calibration learns the
        poured alloy they stop agreeing: the minter measures A356's interval and a recipient
        with no mix measures Al–4Cu's — a different W₀, cell pitch, timestep and thermometer
        behind an identical-looking URL, with `dx` and `dt` on the share SKIP list so the link
        cannot even detect it. Fixed by adding an optional `mx` field carrying the composer's
        own `#alloy=` payload ("al:Si7,Mg0.35"), restored **before** the params block that
        re-runs `setSolver`, and restored by hand rather than through `applyAlloy` — which is a
        POUR and would raise the undercooling, cap the cooling rate and re-arm the melt, none
        of which the link asked for. Every pre-v7.1 link still restores: it simply has no `mx`.
      - **The six silent drops, honestly counted.** Four are converted and driven. `derive()`'s
        unknown-element filter became three named shapes (unknown key, non-numeric weight,
        negative weight) plus a fourth for an unknown BASE — which `derive()` did not drop at
        all, it **threw**, one line before the filter, reachable from
        `window.__solidify.alloy`. `decodeMix`'s two `continue`s became four named shapes
        (unknown element, malformed term, over-cap clamp, unknown base), with the empty-token
        case deliberately NOT a refusal because `#alloy=al:` and a trailing comma are
        well-formed and lose nothing. `setMaterial`'s silent return is driven by the GPU arm.
        **The sixth cannot fire and the gate says so instead of pretending**: `main.ts`'s 3D
        `if (k in P)` filter drops nothing, because every key `derive().params` emits —
        `alloyOn, c0, mLiq, kPart, dSol` — is a declared `Phys3DParams` field. A seventh site
        with the same shape at `main.ts:437` carries a comment asserting it drops `scen` and
        `alloyOn`; both are declared fields too, so that comment is also wrong.
      - **And the drop the plan named has a second instance it did not.** `applyAlloy` wrote
        `alloyName = name` unconditionally after a `setMaterial` that could refuse — a composed
        name printed over the previous material's still-live thermometer, clock, Γ, ε₄ and
        heat-treat laws. The identical shape sits in the share-link applier: `if (shared.n)
        alloyName = shared.n;` after a guarded `setMaterial`, so a link with a bogus `m` and a
        valid `n` restored the wrong name. Both now honour the refusal.
      - **Refusals and clamps render OUTSIDE the composer**, which is what makes
        `science/index.html`'s "labels every clamp it has to make" true for an `#alloy=` deep
        link that never opens the modal: a new `#matcaveat` under the alloy name, written with
        `textContent` because these strings quote element keys that reached `derive()` from a
        hand-built mix, and a new `#htCaveat` on the heat-treat card — a SIBLING of `#htNote`
        rather than part of it, because four gates read `#htNote`'s textContent and one reads
        `#htReport` byte-for-byte. It renders in `refresh()`, not in the head, because the head
        is built once and a stale caveat is a false one.
      - **Gates: nine browser-free, one GPU, and five of the nine FAIL on the pre-change tree**
        (`ALLOY-SUMS-EXACT`, `ALLOY-REFUSE-NAMED`, `CALIB-MIX-OWN`, `CALIB-MIX-REFUSE`,
        `CALIB-MIX-OFF-IDENTITY`), exit code 1. **The other four pass there, and that is
        correct rather than vacuous**: `ALLOY-CLAMP-REPORT`, `DEPR-CONSISTENT`,
        `PD-CONSTRUCT-AGREE` and `PD-VANTHOFF-CROSSCHECK` pin PRE-EXISTING facts about the
        tree — which bounds bind, how far the printed depression diverges from the integrated
        one, and two per-row baseline tables. They are regression tripwires for a milestone
        that must not move them, and a gate that failed before the change would not be one.
        Stated here rather than left for a reader to wonder about.
      - **`CALIB-MIX-OFF-IDENTITY` is the gate that protects the rest of the suite**, and it is
        why the change is safe: no verify script in the repo pours a composed alloy — not one.
        The only composer touchpoint anywhere is `REFINE-FAIR`, which calls
        `window.__solidify.alloy(mix).params` as a pure query and applies it itself. So
        "no pour ⇒ bit-identical" is the whole compatibility argument, and it is asserted over
        **324 `Object.is` comparisons** (9 si materials x alloy true/false x λ ∈ {3,30} x 9
        fields) against a verbatim transcription of the pre-P1 implementation carried inside
        the gate — not against literals, which would go stale and could be re-baselined by
        editing a number. The two materials without an `si` block are asserted by NAME and by
        count (9 with, 2 without, 11 total), because two nulls compare equal and that is
        exactly the failure `lessons.md:25-42` exists to prevent.
      - **CALIB-BAND's headroom was measured before anything moved: ΔT₀ ∈ [20 K, 100 K] against
        today's 74.70 K.** Its two clauses reduce to that. It calls `setMaterial('al')` and
        never pours, so it does not move — but its four-fold order dependence is now
        load-bearing in a new way, because `setMaterial` clears the poured mix. `CALIB-LOCK`
        was found to be a decoy while surveying: it prints d₀, W₀, W₀/d₀, µm-per-cell and the
        domain size in its detail object and asserts **none** of them; its
        `capillary.model != null` clause is a₁/λ, a function of λ alone. A ΔT₀ regression would
        change CALIB-LOCK's printed numbers while CALIB-LOCK still said OK.
      - **Two self-catches, both by the new gates on their first run.**
        `ALLOY-CLAMP-REPORT`'s expected table said 1045 sits on the c0 floor; it does not
        (1.45 wt% total gives c0raw 0.097), and the entry had been written from memory rather
        than from the tree — the third time in this arc a number was written before it was
        measured, and the first caught within the same commit. `DEPR-CONSISTENT`'s first
        predicate required c0 to survive unclamped, and galv. bath failed by agreeing
        **exactly** while sitting on the c0 floor. The reason is algebra: `mLiq` is DERIVED as
        depression/c0, so `mLiq·c0` puts the same c0 back and **the clamp cancels**. Only the
        depression cap and the mLiq bounds can move what the solver integrates. Measured, the
        worst divergence over the presets is 1045 at 0.318 — it prints 40.7 K and the solver
        integrates 12.9 K — and a dilute Al–0.1Cu probe goes the other way at 3.66 on the mLiq
        floor.
      - **The two gates P0 owed, now written, both pinned per row rather than as bands.**
        `PD-CONSTRUCT-AGREE`: the predicate (eutectic AND C_inv ≤ 60 wt%) admits **15 rows and
        excludes 10**, the ratios are not all 1.0 (so `phasedata.ts` was not generated from
        `alloy.ts`), and **9 of the 15 agree within 25 % on both m and k**. The six that do not
        — fe-Si, ni-Nb, ni-Ti, ni-Cr, ni-W, zn-Al — are printed as named disagreements.
        `PD-VANTHOFF-CROSSCHECK`: **the plan's algebraic form was the wrong rearrangement.** It
        specified |m_at|(1−k) against R·T_m²/ΔH_fus; the ideal dilute liquidus is
        |m_X| = (R T_m²/ΔH)(1−k), so the quantity that should be O(1) is the QUOTIENT
        |m_X|/(1−k), not the product — the two differ by (1−k)². Both are printed. **7 of the
        25 pairs have k ≤ 0.2 and 18 are excluded** (the liveness clause sized after counting,
        as the plan required), and the quotient spans 0.412–2.196, a factor of 5.3 — far too
        wide for a band to assert anything, which is why it ships as a per-pair tripwire that
        catches a mistyped m, k, L, T_m or atomic mass and never as an estimator.
      - **Docs.** `science/index.html` §8 gains two paragraphs: which alloy's freezing range
        the calibration is measuring in (naming the 1504 K that 4340 used to read), and what
        `EXTRAPOLATED GAUGE` means, with d₀ = Γ/[|m|(1−k)c_ref] written out so a reader can see
        why the reference liquid is the thing that fails rather than the arithmetic.
        `TESTING.md` eight → **nine** in all three places, against exactly nine
        `- run: node scripts/verify-*.mjs` lines in `ci.yml`, plus a `verify-alloy.mjs` entry.
        **`README.md` was changed, and the plan said it would not be.** Its composer bullet
        describes what the composer does, and what it does changed: the clamps now render
        outside the modal and a pour recalibrates. Leaving the bullet alone would have left it
        describing the previous behaviour, which is the failure mode the doc-drift note at the
        end of this record is about. Recorded as a deviation rather than done quietly.
      - **AN ADVERSARIAL REVIEW OF THIS MILESTONE FOUND TEN REAL DEFECTS BEFORE IT SHIPPED,
        AND ONE OF THEM WAS A VACUOUS ASSERTION IN A GATE ABOVE.** Four independent lenses over
        the diff — state lifetime, the bit-identity claim, the refusal logic, and the render and
        share surfaces — each finding then handed to a separate reader told to refute it.
        Everything below was reproduced by running the code before it was changed.
        **(1) A shipped preset printed a negative freezing range and a ratio of 7.8×10¹⁰.**
        4340's four non-carbon solutes pull its liquidus to 1493.3 °C, BELOW the Fe–C peritectic
        at 1495 °C, so `primary = T_L − T_inv` came out −1.7 K and the string read "the primary
        actually freezes over only -1.7 K … so the model interval is 77822335467.5x the real
        one". **`CALIB-MIX-OWN` was supposed to catch exactly this and did not: its clause was
        `dT0 > primary`, and 77.8 > −1.7 is true.** A vacuous pass, on the tree, in this
        milestone's own gate. The branch now says there is no primary range left to compare
        against and names the extra depression; the gate asserts the ratio is printed when there
        IS one and is NOT printed when there is not, and that no source string ever carries a
        negative kelvin figure or a NaN.
        **(2) Inherited object keys walked through every guard.** `base.solutes.constructor` is
        truthy, so `{constructor: 5}` passed the unknown-element filter, produced dTL/Q/mLiq/dSol
        of NaN, and left `refusals` EMPTY — the precise silent drop this milestone added the
        channel to close, and one `ALLOY-REFUSE-NAMED` could not see because it only drove keys
        that correctly fail. `Object.hasOwn` throughout, and the gate now drives `constructor`,
        `toString`, `hasOwnProperty`, `__proto__` and an inherited BASE key, plus a NO-NaN-ESCAPES
        arm asserting every driven shape leaves a params bundle of finite numbers.
        **(3) A share link's display name reached `innerHTML`.** `heatpanel.ts`'s panel head
        interpolated `materialLabel()` — which is `alloyName`, set verbatim from a link's `n`
        field — into markup, five lines above the `#htCaveat` element this milestone added. Every
        other user-reachable string in P1 was routed through `textContent` or `esc()`; this one,
        pre-existing, was not. Now `textContent` on its own node.
        **(4) The WIRE was applied to one of applyAlloy's two branches.** The 3D branch returns
        before it, and calibrated mode is 2D-only to ENTER but nothing turns it off on the way
        into the volume — so pouring in 3D still dropped out of the calibration while
        `solver` said QUANT. Worse, the 3D branch set `pouredMix` without ever writing the
        chemistry to `sim.params`, so returning to 2D and calibrating paired one alloy's ΔT₀
        with another alloy's solute field. The chemistry assign and the WIRE both moved above
        the branch.
        **(5) `setMaterial` left a live calibration running the wrong material's dials.** It
        `Object.assign`s the new material's Kobayashi latent/delta/dSol and never re-entered
        `setSolver` — the same defect the WIRE closes for pours, at its other call site, reachable
        from the material dropdown. It also never refreshed `kobSnapshot`, so LEAVING calibrated
        mode after a material swap restored the PREVIOUS material's dials. Both fixed.
        **This change broke CALIB-BAND, and the break was informative:** that gate inherits
        `solver = 1` from QPF-MASS, which writes it straight onto `sim.params` without going
        through `setSolver`, so `setMaterial('al')` would now have re-derived a calibration and
        the "Kobayashi" baseline would have read 74.7 K instead of 249.2 K. It passed before only
        because `units.ts` derives kelvin-per-unit from `latent`, which `setMaterial` restores.
        The gate now clears the solver explicitly and says why, which is what the plan's risk
        note asked for by a different route.
        **(6) Nothing invalidated the pour when the composition dials moved.** The c₀ slider
        writes `sim.params.c0` directly, `setParams` is called by every preset, scene and tour
        chapter, and a share link assigns the whole bundle — none of them go through
        `setMaterial`. Chasing writers is a losing game, so `pouredMix` now carries a STAMP of
        the four chemistry keys it wrote and `calibrateNow` checks it at the point of use;
        a mismatch drops the override and names it. `CALIB-POUR-WIRED` drives it. It also closes
        a hole nobody was aiming at, raised in passing by one of the refutation readers: a 3D
        share link carries `mx` but skips the `if (shared.d !== 1)` block that writes the
        params, so `pouredMix` would be set while `sim.params` still held the base material's
        chemistry. Checked rather than assumed — the stamp reads c0 0.490 / mLiq 0.396 /
        kPart 0.137 against aluminium's 0.30 / 0.50 / 0.14, so the guard fires.
        **(7) A link that applied NOTHING said nothing.** `applyHash` built a refusal sink, and
        threw it away on the early return — so `#alloy=al:Xx3`, the loudest possible failure,
        was the silent one. It now reports through a new host method, and the gate drives it.
        **(8) `k_eff = 1` was refused with a false reason.** Ni–Cr ships k = 1 exactly, and the
        composer's "+ add element → Cr" default reaches it on the first click. The refusal said
        the partition "falls outside the physical range" — it does not; the partition is
        perfectly physical and it is the freezing range that is zero-width. Separate clause,
        correct sentence.
        **(9) The zero-depression refusal blamed the wrong solute.** It always named `dominant`,
        which is the largest |m·c| term and can be a DEPRESSANT in a mix whose raisers merely
        outweigh it; and it asserted the liquidus was "raised" even where the melt was depressed
        by less than the epsilon. It now finds the actual raiser and has a second sentence for
        the near-cancellation case. Ni–2Cr–3W now correctly names W rather than Cr.
        **(10) Three smaller ones, all real.** A weight of 1e308 overflowed the m·c sums to
        ±Infinity and put NaN in the params bundle and in the refusal string — a weight PERCENT
        cannot exceed 100, and the sum cannot either, which also closes the unguarded
        `molBase = (100 − totalWt)/mass` going negative. `parseFloat` on a bare "." gave NaN,
        and `NaN !== NaN` then fired the cap-violation branch, naming the wrong mechanism while
        still writing NaN into the mix. And `#matcaveat` sat inside `#head`, the one
        absolutely-positioned overlay without `pointer-events: none` (it carries the h1's link),
        so a multi-line caveat grew a click-dead band directly over the melt.
        **Also raised and REFUSED after checking:** that `calibrateNow` mixes a clamped `c0wt`
        with an unclamped override — `referenceInterval` returns the override before it reads
        `c0wt` at all, so the two never meet; and that `calibrate()` accepts any positive
        override — true, and a lean mix like Cu–0.05Zn really does give ΔT₀ = 0.03 K, a 7 µm
        capillary length and a 197 µm cell, but that is what a nearly-pure melt's capillary
        length IS. It now carries a named warning rather than a silent 200 mm domain.
      - **The doc-drift gap this milestone opened, closed in the same milestone.** Writing the
        new §8 paragraphs put a dozen computed constants into prose — 4340's 1504 K default and
        78 K poured range, A356's 303 K against its 35 K real primary range, the 8.7x between
        them, the 53 wt% reference liquid, A356+TiB's −0.59 — and nothing gated any of them,
        exactly as nothing gates the older "11 K instead of 37 K" two paragraphs up.
        `PD-DOC-CALIBRATION` (browser-free, the tenth check in `verify-alloy.mjs`) recomputes
        all twelve from `BASES`/`MATERIALS`/`phasedata` and requires each to appear in the page
        as written, the same way `HT-DOC-CONSTANTS` polices the heat-treatment constants. It
        caught one on its first run — the prose sets minus signs as U+2212 and the code emits
        ASCII hyphens, so both sides are normalised before comparison rather than leaving a
        typography check wearing a physics gate's name.
      - **Still owed, and not silently dropped.** The honesty page's "11 K instead of 37 K" at
        §319-321 is CALIB-BAND's own numbers and is still true, because the no-pour path did not
        move — but it is a GPU-gate output, so `PD-DOC-CALIBRATION` cannot recompute it
        browser-free and it remains ungated. That sentence is the one remaining unpinned
        calibration constant in the honesty page.

- [x] **P2 — the diagram is drawn, the pour is pinned at its own liquidus, and the cursor is the thermometer.**
      S. Cai's ask, landing third rather than last, because the figure is what makes every later refusal legible. Drawing the **straight chords** is not a compromise: they are the linearised diagram this solver integrates, so the figure is a picture of the model rather than a picture of a textbook, and the real curvature becomes an honest caveat instead of a missing feature.
      - **New `src/phasediagram.ts` exporting a pure `layout(row, base, mix, T)`** returning data-space vertices — liquidus chord, solidus chord, solvus, invariant horizontal, phase-field label anchors, pour marker, temperature cursor — plus a thin SVG renderer over it. Pure so it gates browser-free; the renderer is then only a coordinate transform. `layout()` returns vertices and the renderer mutates existing path `d` attributes rather than rebuilding the tree, because it redraws on every slider input.
      - **The marker sits at the mix's real liquidus, and the residual is drawn as a labelled offset.** For a multi-solute mix the panel draws the **dominant binary** — the solute carrying the largest |m_i·c_i| — and names the fraction of the total depression it carries, **computed in code, not quoted** (for 4340 carbon carries roughly 31 of 44.5 K; for A356+TiB Si carries roughly 46 of 48 K of depression against a mix ΔT_L of 44.7 K, and the plan does not hardcode either). The marker's ordinate is the mix's own T_L, not the binary's, and the gap is drawn and labelled: "the other four solutes pull this melt a further 13 K below the Fe–C liquidus; that depression is in the solver and is not on this diagram." Without this the marker floats off the drawn curve with no explanation, or is snapped onto it and the app asserts a liquidus 13 K warmer than the number it printed one panel over.
      - **When the solver's slope is clamped, the figure draws both lines.** `derive()` clamps `mLiq` to [0.1, 0.8] and caps `deprDim` at `DEPR_CAP = 0.22`, and measured, 6 of 9 presets are clamped. Whenever the chord and `mLiq·tScale` differ, the figure draws the cited chord as the data line and the clamped slope the solver actually runs as a second, visibly distinct line, with the clamp string beside it. Otherwise the honesty caption ("this is the line the solver integrates") is false exactly where it matters.
      - **Gates.** `PD-FIGURE-GEOMETRY` (browser-free) — the drawn geometry IS the data: the liquidus polyline's endpoints are exactly (0, T_base) and (Cinv, Tinv), the solidus's exactly (0, T_base) and (Csm, Tinv), the solvus vertical at exactly Csm, the invariant horizontal at exactly Tinv, all `Object.is` against the row; the solidus lies at or below the liquidus at every sampled composition; the pour marker's data coordinates round-trip through the px transform to (c_dominant, T_L^mix) within 1e-9 **and its ordinate equals `derive(mix)`'s liquidus**; for every multi-solute preset the residual offset is non-zero and rendered. Explicitly not "the SVG contains more than N paths". Both clamp branches asserted exercised — at least one shipped preset draws the second polyline and at least one does not — so a figure that never draws it cannot pass vacuously. Liveness: every row emits ≥ 4 polylines with every ordinate finite. `PD-CURSOR-LIVE` (GPU) — the cursor's data temperature equals what `units.ts`'s own formatter reports for the melt, through the same code path, at two separate reads, **and the two reads differ**. Asserting only that it moved downward would be the PIN3-LIVE directional-proxy mistake in a new costume. Second arm: with an abstract material (`si === null`) the thermometer returns NaN, the formatter renders an em dash, and the cursor is asserted ABSENT rather than plotted at zero. Third arm: once the casting is fully solid `StatsResult.meanLiqT` is null (`sim.ts:104-105`) and the cursor must refuse rather than fall to zero. `PD-NO-ROW-REFUSES` (browser-free) — every base or pair with no row (ice, scn, qc, generic, any unpaired element) refuses to draw with a named non-empty reason, distinct-reason set size equal to the number of distinct missing cases, and **no empty axis frame is ever emitted**; both polarities, so a `layout()` that refused everything cannot pass.
      - **Risks.** The dominant-solute choice is a real simplification and must never read as the mix's own diagram: for IN718-lite the dominant binary is Ni–Nb, and the Laves phase and Nb-rich interdendritic liquid that make IN718 interesting are absent from both the diagram and the solver — the panel names that, or the feature over-claims exactly where it is weakest. The composer card is capped at `min(500px, 94vw)` with `max-height: 88vh` (`app/index.html:124`) and the pour button is already the scroll floor; the figure appends after the derived readout, never among the solute rows. Nothing in `scripts/*.mjs` currently drives the composer DOM — grep finds only `window.__solidify.alloy(mix)` — so no existing selector breaks, but there is also no precedent to copy.
      - **Docs.** `science/index.html` gains the figure row: drawn from looked-up invariants with a citation on every row, straight chords rather than the real curved boundaries, and the second line when the solver's slope is clamped away from the chord.

      - **DONE 2026-08-15.** New `src/phasediagram.ts`: a pure `layout(mix, meltC)` returning
        vertices in DATA space, plus a `PhaseFigureView` that is only a coordinate transform over
        it. 24 of the 25 pairs draw; the 25th refuses, for a reason found by drawing it.
      - **DRAWING THE ROWS FOUND A DEFECT IN P0'S TABLE THAT READING THEM DID NOT.** `ni-W` is
        geometrically impossible. Its invariant is 1495 °C against nickel's 1455 °C, so the
        Ni-rich liquidus RISES with tungsten — and a rising liquidus means the first solid is
        RICHER in solute than the liquid (k > 1), which at the invariant requires C_SM > C_inv.
        The row has C_SM 39.9 < C_inv 45, the liquid richer, chord k = 0.887. Both cannot be
        true: with C_SM < C_inv the (Ni) solidus reaches 1495 °C at a SMALLER composition than
        the liquidus, rises faster, and ends up ABOVE it — and a solidus above a liquidus is not
        a phase diagram. Every other one of the 24 non-isomorphous rows passes the same test,
        **including the two others whose invariant also sits above their base's melting point**:
        Al–Ti (665 °C, C_SM 1.32 > C_inv 0.15) and Mg–Zr (653.6 °C, 2.58 > 0.58), both k > 1,
        both consistent. So the test is not an artefact of assuming a falling diagram.
        **Not repaired.** The shipped dilute k = 1.3 agrees with the rising liquidus and
        disagrees with the chord — which is the same disagreement `PD-CONSTRUCT-AGREE` already
        records for this pair (0.89 / 0.68) — so one of T_inv, the reaction type, or the
        C_SM/C_inv pair is wrong and this instrument has not resolved which. The numbers stand
        as read from the ASM figure, the row's own `source` states the contradiction in full,
        `phasediagram.ts` REFUSES to draw the pair, and `PD-SLOPE-CONSISTENT` carries `ni-W` as
        its single named exception. `PHASE_TABLE_VERSION` 1.0.0 → **1.0.1**.
      - **THE NEW GATE IS THE EXCEPTION LIST.** `PD-SLOPE-CONSISTENT` (in `verify-phasedata.mjs`,
        so it sits with the data it polices) fails on a NEW inconsistent row and fails equally if
        `ni-W` quietly becomes consistent without this note being updated, or if its source stops
        explaining itself. Liveness: at least two rows must have rising invariants, or the branch
        is never exercised at all. **It FAILS on the pre-change tree** (`badSourced: ["ni-W"]`)
        and passes after — the same vacuity check every gate in this arc has been held to.
        `PD-ORDERING` could not have caught this: it checks C_SM < C_inv within a row, and this
        is a relation BETWEEN the temperatures and the compositions.
      - **The construction is one pair of chords for all three geometries.** Liquidus
        (0, T_m) → (C_inv, T_inv), solidus (0, T_m) → (C_SM, T_inv), the invariant horizontal
        between them, the solvus vertical at C_SM. A falling eutectic puts the solidus left so it
        falls faster; a k > 1 peritectic (Al–Ti, Mg–Zr) puts it right so it rises more slowly;
        either way the solidus stays below the liquidus, asserted at 40 sampled compositions per
        row. Isomorphous rows (Fe–Cr, Cu–Ni) have no invariant to terminate on, so the chords run
        to the axis edge and the horizontal and solvus are asserted ABSENT, not merely unchecked.
      - **The pour marker is at the MELT's liquidus and the residual is drawn.** Measured, and
        the plan's own example was one of the smaller ones: A356 2.2 K · A356+TiB **−1.5 K** ·
        AA2024 9.3 K · 1045 5.6 K · 4340 **13.3 K** · IN718 **27.4 K** · AZ91 4.2 K, and exactly
        0 for the two single-solute presets, which is the other polarity. **A356+TiB's is
        NEGATIVE** — titanium raises the liquidus, so the melt sits 1.5 K ABOVE the drawn Al–Si
        line — and the label carries the sign rather than assuming a depression, which the plan's
        wording ("pull this melt a further 13 K below") would not have. The dominant solute's
        share of the depression is computed, not quoted: Si carries 95.5 % of A356's 48.4 K,
        carbon 70.1 % of 4340's 44.5 K, niobium 66.1 % of IN718's 81.0 K.
      - **The second line, and both branches exercised by shipped presets.** Wherever the model's
        clamps have moved the depression it integrates, a dashed chord runs to that point with
        the clamp string beside it: 5 of the 9 presets draw it (1045 prints 40.7 K and integrates
        **12.9 K**; 4340 44.5 → 35.3; IN718 81.0 → 52.5; AZ91 66.3 → 37.6; bronze 59.2 → 58.6)
        and 4 do not. Cu–Ni is the sharpest case of all and it is not a preset: nickel RAISES
        copper's liquidus, so that melt has no depression whatever, and the model's mLiq floor
        integrates a fabricated 8.9 K one.
      - **Two frame bugs, both caught by the gate after it was tightened, and the second by the
        fix for the first.** The frame was first sized on the chords' value at the axis EDGE,
        which extrapolates a boundary past where it exists: the Al–Si solidus falls 50.5 K/wt%
        and only reaches C_SM = 1.65 wt%, so reading it at 13.6 wt% put A356's y-axis at
        **−96 °C** and crushed the whole diagram into the top third of the box. The gate had
        passed, because "the frame is non-degenerate" is not the same claim as "the frame is
        tight" — so it now asserts that everything drawn fills ≥ 60 % of the box height and that
        no drawn vertex falls outside it. Re-run, that immediately caught the second: the solver
        chord's endpoint was computed AFTER the frame, so Cu–Ni's fabricated depression put a
        drawn point below the floor. Both fixed; the second would not have been found without
        the first fix.
      - **The cursor, and the three absences that are three different facts.** It draws only when
        the melt's temperature is on the diagram. Off it, the cursor is ABSENT and the panel
        NAMES it ("the melt is at 436 °C, off this diagram (569–669 °C) — the cursor is not drawn
        rather than pinned to an edge"). With no liquid left it is absent and SILENT, because
        `sim.ts` returns `meanLiqT: null` and never 0 — 0 is a legitimate dimensionless
        temperature one whole reference interval below the melting point. With an abstract
        material it is absent and silent, because `units.known` is false and the converter
        returns NaN by design. `generic` is the BOOT DEFAULT, so that third case is the starting
        state rather than an edge case.
      - **`composer.tick()` joins the frame loop beside `slicePanelUI.update()`**, above the
        2D/3D branch and for the same reason — both would otherwise be stranded by the `return`
        at the end of the 3D block. Before this the composer was INPUT-DRIVEN ONLY: nothing
        re-rendered it while it was open, so a temperature drawn at `open()` would sit frozen
        over a casting that kept solidifying. The figure lives in its own `.figwrap` container
        because `renderOut()` replaces `.derived`'s innerHTML on every slider frame and would
        otherwise rebuild the entire SVG sixty times a second, and its prose is diffed against
        the mix so only the cursor's two attributes actually move per tick.
      - **`meltC()` moved onto the app**, beside `units()`, rather than being recomputed per
        panel — so the diagram's cursor and the corner readout cannot drift apart. Mode-aware for
        the same reason `unitsNow()` is: the 3D branch of the frame loop returns before the 2D
        stats block, so `lastStats` is frozen and stale the whole time the user is in the volume.
      - **`PD-CURSOR-LIVE` got its own file, and the reason is worth recording.** Written inside
        `verify-quant.mjs` first, it could not pass there, and neither failure was in the code
        under test. Every QPF-* block above it stages the solver by writing `solver`, `lambda`,
        `dx`, `dt` and `frozenT` straight onto `sim.params` and none of them puts anything back.
        With `frozenT: 1` inherited the temperature field is FROZEN, so the melt sat at exactly
        its staged value forever and both reads of a perfectly good cursor came back identical.
        With `frozenT` cleared, the inherited dimensionless timestep advanced sim time so fast
        that 90 frames cooled the melt past the shader's own [−1, 2] readout clamp to 162 °C,
        three hundred degrees below the diagram. A gate that needs a pristine app should open
        one — the same reason `verify-experiment-gpu.mjs` is not inside `verify-experiment.mjs`.
        On a clean page it passes: 581 °C then 572 °C, each equal to `units.fmtC`'s own
        conversion of `meanLiqT` — the SAME formatter the corner readout uses — and the two reads
        DIFFER. "It moved downward" would be the PIN3-LIVE directional-proxy mistake in a new
        costume: a cursor wired to solid fraction would also move downward.
      - **Two more of the gate's own setup errors, both instructive rather than incidental.**
        A Kobayashi undercooling of 0.9 — which `applyAlloy` sets on every pour — is 224 K below
        aluminium's melting point, so the first version's melt was at 436 °C, clean off the
        Al–Si diagram, and the cursor was correctly absent. That case is now its own asserted
        arm rather than an accident. And the fully-solid arm needs `pPore: 0`: a shrinkage pore
        PINS its cell's φ below 0.5 and never freezes, so the stats kernel counts it as liquid
        forever and `meanLiqT` never becomes null however long the cast runs. With pores off the
        casting reaches fracSolid **1.0** and the thermometer goes null, which is the state the
        arm exists to test.
      - **AND ONE MORE, FOUND WHILE THE SUITE RAN, ONE CLICK FROM THE USER.** The composer's
        STAGED mix and the material actually in the crucible disagree the moment a famous-alloy
        button is pressed without pouring. Press AZ91 while aluminium is loaded and `layout()`
        was asked to draw Mg–Al while `meltC()` reported the ALUMINIUM melt — and 600 °C sits
        comfortably inside the Mg–Al frame of 416–671 °C, so the cursor drew, labelled
        "melt 600 °C", on a magnesium diagram. A wrong statement rather than a missing one, which
        is the standard the rest of this arc is held to. `layout()` now takes the melt's own
        material key, withholds the cursor when it does not match the diagram's base, and says
        why ("the melt in the crucible is aluminum · Al–Cu, not magnesium — this diagram is for a
        mix you have staged but not poured"). Reproduced before it was fixed and gated in three
        directions afterwards: withheld and named when they disagree, DRAWN when they agree, and
        the check skipped entirely when no key is supplied, which is what the geometry-only
        callers rely on.
      - **`tick()` throttles on the cursor's own printed precision.** The label is whole degrees
        and `meanLiqT` only refreshes at the readouts' 4 Hz cadence, but `layout()` rebuilds a
        dozen sentences per call and the frame loop calls it at 60 Hz. Keyed on the rounded
        temperature and the material, so a paused melt costs one string comparison per frame, and
        any mix change clears the key so the next tick always goes through.
      - **THE ADVERSARIAL REVIEW FOUND FIVE MORE — 6 confirmed and 5 refuted across three
        lenses — AND TWO OF THEM WERE DRAWING THINGS THAT CANNOT EXIST.** All five reproduced
        before they were fixed.
        **(1) The isomorphous solidus clamped k to 0.999, and Cu–Ni ships k = 1.35.** So the
        drawn solidus used m/0.999 instead of m/1.35 and ended 0.04 K **ABOVE** its own liquidus
        — the exact impossible geometry this file refuses ni-W over, thirty lines further up,
        rendered without complaint. The clamp had been copied from `referenceInterval`, where it
        belongs because k divides into a freezing range; here it is simply wrong. Corrected
        endpoint 1115.25 °C against the 1125.93 it was drawing. **`PD-FIGURE-GEOMETRY` said OK,
        and that is the more important half**: its solidus-below-liquidus check only ran in the
        invariant branch, so the isomorphous rows were never sampled. The hole is closed — the
        same 40-point ordering check now runs on both branches, plus an assertion that the two
        chords are not coincident, since two identical lines would satisfy an ordering test.
        **(2) The residual bar was measured against a line that is not on the figure.** It ran
        from the DILUTE binary liquidus while the drawn liquidus is the invariant CHORD, and P0
        measured that those disagree for 10 of the 22 pairs. Tin bronze is the sharpest case and
        the old gate's shape hid it: a SINGLE-solute mix, so the "other solutes" gap was exactly
        zero, no bar was drawn, the "drawn iff multi-solute" assertion passed — and the marker
        floated **30.8 K above the orange line** with nothing on screen to explain it. The bar
        now starts on the drawn liquidus and the gap is DECOMPOSED, because it has two causes
        and they are different facts: how much is the other solutes, and how much is this pair's
        own dilute slope disagreeing with its invariant chord. Tin bronze now reads "30.8 K of it
        is Cu–Sn's own dilute slope (−7.4 K/wt%, what the solver integrates) disagreeing with the
        invariant chord this line is drawn from" — which is P0's measured ratio, drawn. The gate
        asserts the decomposition sums to the whole, that the bar's endpoints ARE the drawn
        liquidus and the marker, and that both causes are exercised by shipped presets.
        **(3) The reason given for choosing the binary refuted itself.** `derive()` picks the
        dominant solute by |m·c|, which counts liquidus RAISERS, but the note computed its share
        from depression alone — so an Al–0.5Ti–0.1Cu mix read "chosen because Ti carries 0 % of
        the depression", and an all-raiser mix quoted a percentage of 0.0 K. The share is now
        computed on the same quantity that picked the dominant, and the sentence says liquidus
        SHIFT with the depression named separately: "Ti carries 98 % of this melt's 15.7 K of
        liquidus shift (of which 0.3 K is depression)".
        **(4) The two-phase field's width was assumed rather than measured, and it printed a
        false claim.** The isomorphous arm took a hardcoded 5 % of the axis as the field's
        width, so Cu–Ni's genuinely 10.6 K-wide freezing lens had its label suppressed and the
        panel said "Ni in copper barely partitions (k 1.35)" — false on both halves, since 1.35
        partitions strongly and the field was narrow only because the test was. Fe–Cr's 0.57 K
        field IS genuinely too narrow and its note was correct, which is exactly what hid it:
        one of the two isomorphous rows behaves. The width is now measured — both chords run
        straight through (0, T_m), so a point on one meets the same temperature on the other at
        a fixed ratio, k for an isomorphous pair and C_SM/C_inv for a row with an invariant —
        and the note reports the measured wt% instead of inferring a claim about partitioning.
        **This one came out of a CORRECTION the refutation reader made to its own reviewer's
        rationale**, while confirming a different defect; it was not in any finding as filed.
        **(5) A hidden cursor kept reporting a stale temperature.** `#pdCursor` is the node
        `PD-CURSOR-LIVE` reads; hiding it left "melt 581 °C" in its textContent after the melt
        had gone off the diagram or solidified. Cleared, not just hidden.
      - **Gates.** `scripts/verify-phasediagram.mjs` — three browser-free checks, the **tenth**
        CI member. `PD-FIGURE-GEOMETRY` ties every drawn vertex to the row with `Object.is`, over
        all 24 drawable pairs plus the 9 presets, and explicitly is NOT "the SVG contains more
        than N paths"; the pour marker round-trips through the exported px transform, because a
        transform exercised only by the renderer is one no gate can see. `PD-NO-ROW-REFUSES`
        drives 11 undrawable cases against 6 drawable ones, requires 40+ character reasons and a
        matching distinct-reason count, and requires ni-W's refusal to name the GEOMETRY rather
        than claim there is no row. `PD-FIGURE-CURSOR` settles the three absences without a GPU.
        `scripts/verify-phasediagram-gpu.mjs` — `PD-CURSOR-LIVE`, four arms, its own page.
      - **Docs.** `science/index.html` §8 gains the figure's two paragraphs, including what it
        will NOT do — the dominant binary is not the alloy's own diagram, and IN718's Laves phase
        is on neither the drawing nor in the solver — and the ni-W refusal in full. `TESTING.md`
        nine → **ten** in all three places against exactly ten `- run:` lines in `ci.yml`, plus
        entries for both new scripts and for `PD-SLOPE-CONSISTENT`. `README.md`'s composer bullet
        gains the figure.

- [x] **P3 — three regimes, a ceiling that comes from the diagram, and the invariant fraction the solver will never grow.**
      Where "adhere to alloy design of course" stops being a slider max and becomes derived physics. The hand-picked `cap` becomes what it always was — a slider bound — and the ceiling moves **inside `derive()`**, where the `window.__solidify.alloy({base:'al', wt:{Si:50}})` hook that `verify-tools.mjs:538` uses cannot walk around it. `derive()` does no cap check at all today.
      - **`regimeOf(base, el, wt)` returns type-neutral regimes, and the invariant type is load-bearing.** SINGLE-PHASE (c ≤ Csm) · TWO-PHASE-TERMINATION (Csm < c < Cinv) · PAST-THE-INVARIANT (c ≥ Cinv) · SINGLE-PHASE-ALL-COMPOSITIONS (isomorphous rows, no invariant, no Csm). The regimes are **not** called HYPOEUTECTIC, because P0 enters Fe–C, Cu–Sn, Cu–Zn, Al–Ti and Mg–Zr as peritectics and the label would be false for all of them.
      - **The invariant fraction is printed only for eutectic rows, and the formula is the corrected one.** Equilibrium lever f = (c0 − Csm)/(Cinv − Csm); Gulliver–Scheil f_E = (Cinv/c0)^{1/(k−1)}. For a peritectic row the panel prints the reaction and the phase by name and **refuses the fraction** — "L + δ → γ at 1495 °C; this instrument does not model a peritectic reaction and will not put a number on it" — the same shape as the 3D panel declining to print d_lim. Both assumptions behind Scheil (constant k, zero solid back-diffusion) are printed in the panel, not only on the science page. Regime I is honest about itself: equilibrium says single-phase, Scheil says a real fraction freezes as eutectic anyway, and this solver grows neither.
      - **The two-column readout and the regime shading.** `Derived` gains `regime`, `notGrown: string[]` and `invariantFraction: {lever, scheil} | null`. The composer shades the regime band on the P2 figure and adds PHASES EQUILIBRIUM PREDICTS vs PHASES THIS SOLVER GROWS. The arc's best sentence lives here, with both numbers computed rather than quoted: "A356 at 7 wt% Si terminates two-phase — primary α-Al dendrites are modelled; roughly half of this casting freezes as Al–Si eutectic, and this solver grows none of it."
      - **The chord-vs-shipped-slope disagreement is printed as a dilute-limit validity note.** P0 already computes it. AZ91 at 9 wt% Al, tin bronze at 8 wt% Sn and IN718-lite's four superposed solutes are all far outside any dilute limit and the linear liquidus is applied there anyway; naming the disagreement per solute is cheaper and more honest than a validity ceiling nobody measured.
      - **Share links restore, clamp to the new ceiling, and say so.** `#alloy=al:Ti0.5` is mintable today (`decodeMix` clamps to `cap = 0.5`) and would be refused outright by a whole-rejection policy — which contradicts the non-negotiable that every pre-change link restores. Instead: restore, clamp to the ceiling, and push a named entry into `refusals[]` that renders outside the modal on the channel P1 built. Same for `al:Fe2` (cap 2 vs eutectic 1.7) and `mg:Zr0.8` (cap 0.8 vs peritectic 0.6). `composer.ts:67`'s new-element default changes from `min(1, cap)` to `min(1, ceiling)`, or clicking "+ add element → Ti" would immediately produce a refusal instead of an alloy.
      - **Gates.** `PD-REGIME-EXACT` (browser-free) — for every row with an invariant, c = Csm ∓ 1e-9 and Cinv ∓ 1e-9 classify on both sides; across the Cinv boundary the NAME of the primary solidifying phase differs, with both names asserted non-empty and drawn from the row's own fields so two empty strings cannot pass as "different"; isomorphous rows take the SINGLE-PHASE-ALL-COMPOSITIONS branch and that branch is asserted exercised by ≥ 1 row. Not "A356 comes out two-phase", which one hardcoded branch satisfies. `PD-INVARIANT-BAND` (browser-free) — both closed forms recomputed inside the gate to 1e-9, then their ordering invariant: for every eutectic row with k < 1, lever ≤ Scheil at every sampled c in (Csm, Cinv); endpoints lever → 0 and Scheil → (Cinv/Csm)^{1/(k−1)} > 0 at c = Csm, both → 1 at c = Cinv. Peritectic rows are asserted EXCLUSIONS that emit a named refusal, so a predicate that silently swallowed them cannot pass. Anchored on Pb–Sn (61.9 wt% Sn, 183 °C) carried as **gate-local test data**, not as a `phasedata.ts` row — Pb is not a base and a row there would break PD-ROW-SOURCED's bijection. Liveness: the A356 band is non-degenerate and both bounds lie strictly in (0,1). `ALLOY-PHASES-NAMED` (browser-free) — both polarities over the 9 presets: every preset above its Csm emits exactly one non-empty `notGrown` line per over-solubility solute containing that row's own `second` token; every preset below emits none; the lines are DISTINCT as a set. Liveness: at least one preset lands in each of the first two regimes, or the classifier is a constant function. `PD-CAP-CEILING` (browser-free) — no composition at or past Cinv is reachable by any route (slider, share link, or the `__solidify.alloy` hook), and `derive()` itself refuses, naming the primary phase and the number. The four measured defects are pinned as named regression cases: Fe–C cap 2 vs 0.53, Al–Fe cap 2 vs eutectic 1.7, Al–Ti cap 0.5 vs peritectic 0.15, Mg–Zr cap 0.8 vs peritectic 0.6. Liveness: all 9 presets still pour — 1045 at 0.45 C and 4340 at 0.40 C sit under the 0.53 peritectic, A356+TiB's Ti at 0.12 under 0.15 — so a ceiling that refused everything cannot pass. `ALLOY-SHARE-CLAMP` (browser-free) — a corpus of pre-arc links round-trips to a restorable mix; over-ceiling links restore clamped **with** a named refusal present; malformed input is rejected whole with a named reason rather than silently reduced (closing `alloy.ts:199,201`).
      - **Risks.** Tightening Fe–C from 2 wt% to a refusal above 0.53 wt% **removes cast iron from the composer**. That is correct — the app has no γ and no cementite, and `materials.ts:72` says the steel is modelled as BCC δ-ferrite, so today it draws 4-fold δ dendrites for a melt whose primary phase is FCC austenite. It is an INTENDED break, recorded as one here rather than discovered later as a regression, and the refusal teaches instead of the slider range silently shrinking. The drawn Fe–C figure will still show the 4.3 wt% eutectic that the slider can no longer reach; the figure says so explicitly ("this instrument stops at the peritectic") or it misleads.
      - **Docs.** `science/index.html` gains its two rows **in this commit**, not in P6: the regime row (what the ceiling is derived from, and that cast iron is out of range by construction) and the phases row (read from a diagram, not grown by the solver). P6 is the tour, the front door and the doc gate — not a documentation catch-up bin.

      - **DONE 2026-08-16.** `alloy.ts` gains `phasesFor()`, `soluteBound()` and six new
        `Derived` fields; the ceiling moved INSIDE `derive()`'s filter, where the
        `window.__solidify.alloy` hook cannot walk around it; `phasediagram.ts` shades the
        regime band; the composer prints the two columns. New `scripts/verify-regimes.mjs` is
        the **eleventh** browser-free CI member. All five of its gates FAIL on the pre-change
        tree, four of them for reasons about BEHAVIOUR rather than about a missing symbol.
      - **THE CEILING BINDS FOR FIVE PAIRS, NOT FOUR, AND THE FIFTH IS THE SHARPEST.** The plan
        named Fe-C (cap 2 against a 0.53 wt% peritectic), Al-Fe (2 against 1.8), Al-Ti (0.5
        against 0.15) and Mg-Zr (0.8 against 0.58). Measured, there is a fifth: **Zn-Al, whose
        cap of 5 wt% IS the eutectic composition exactly** - the slider's own maximum sat on the
        one composition of that axis where the primary phase changes, so dragging it to the end
        gave a melt whose first solid is the Al-rich phase while the solver grew zinc. All five
        are pinned as named regression cases; the slider maxima are now 1.75 / 0.14 / 0.52 /
        0.57 / 4.95, one step below each invariant.
      - **CAST IRON IS OUT, AS APPROVED, AND THE MARGINS ARE MEASURED.** Fe-C stops at 0.52 wt%
        C. 1045 and 4340 survive at 0.45 and 0.40, and the liveness clause is that all nine
        presets still pour - a ceiling that refused everything cannot pass this gate. The
        tightest margin in the shipped set is **A356+TiB's titanium, 0.03 wt% under its 0.15 wt%
        peritectic**, then 1045's carbon at 0.08. Those two are what a future tightening breaks
        first, so `PD-CAP-CEILING` prints them on every run.
      - **THE BOUNDARY ORDER IS LOAD-BEARING, AND THE OBVIOUS ORDER IS WRONG.** C_inv is tested
        BEFORE C_SM. For the two rows whose base solid is the peritectic PRODUCT - Al-Ti and
        Mg-Zr - the invariant liquid is LEANER than the maximum solid solubility (0.15 against
        1.32; 0.58 against 2.58), so `c > C_SM` is false right through the region where the
        primary phase has already stopped being aluminium. Classified the other way round those
        two rows report SINGLE-PHASE for a melt whose first solid is Al3Ti. It also means
        TWO-PHASE-TERMINATION is structurally unreachable for that class - correct rather than a
        gap, because their whole two-phase band lies past the invariant - and `PD-REGIME-EXACT`
        asserts that topology separately instead of skipping the branch.
      - **TWO DECODER DEFECTS, BOTH FOUND BY WRITING THE GATE'S CORPUS, BOTH REPRODUCED ON THE
        SHIPPED TREE.** (1) `#alloy=al:Si1.2.3` silently restored **1.2 wt% Si** and said
        nothing: P1's own comment named "1.2.3" as a token parseFloat mangles and then guarded on
        `Number.isFinite`, which `parseFloat("1.2.3") === 1.2` sails straight through - the case
        was named and half-closed. The weight is now validated as a SHAPE, which still accepts
        everything `encodeMix` mints and everything parseFloat read correctly, including a
        leading-dot ".5". (2) The payload pattern `[A-Za-z0-9.,]*` **truncated at the first
        unrecognised character**, so `#alloy=al:Si7%20Mg0.35` matched only "Si7" and the whole
        magnesium term vanished before the decoder could see it, let alone name it. Captured to
        the next parameter instead, every term now reaches the shape test and a malformed one is
        quoted in full rather than as a prefix of itself. Same defect class as the first: an
        input silently REDUCED rather than named, which is the exact thing P1's refusal channel
        was built to stop.
      - **`shortPhase` returned a single letter for one row**, caught by `PD-REGIME-EXACT`'s
        "both names non-empty" clause: Fe-Mo's second phase is literally the **R phase**, and
        "R" alone under a diagram - "(Fe) + R" - names nothing a reader can look up. A
        one-character phase now keeps the word after it. Measured over all 24 rows carrying a
        `second`, it is the only one that changes.
      - **THE FRACTION IS PRINTED FOR A EUTECTIC AND REFUSED BY NAME FOR A PERITECTIC.** A356 at
        7 wt% Si: lever 48.9 %, Gulliver-Scheil 50.9 %, and this solver grows none of it. 1045's
        0.45 wt% C is past delta-ferrite's 0.09 wt%, so equilibrium ends it as austenite through
        L + delta -> gamma at 1495 C - and the reaction gets NO number, because the lever rule
        and Gulliver-Scheil both describe a liquid freezing to two solids and neither describes
        a liquid and a solid reacting to make a third phase. Both closed forms use the row's own
        chord partition k = C_SM/C_inv rather than the shipped dilute k, so the two numbers come
        out of one table rather than two, and the printed string says which.
      - **`PD-INVARIANT-BAND`'s anchors are INDEPENDENT statements, not the same formula twice.**
        As k -> 0 the solid takes nothing, so mass balance alone fixes the eutectic share at
        c0/C_inv, and Gulliver-Scheil must approach it - a transposed exponent does not. The
        lever rule is linear, so a quarter of the way across the band it is exactly 0.25, which a
        flipped lever returns as 0.75. Both run on **Pb-Sn** (61.9 wt% Sn, 183 C, 18.3 wt%
        solubility) as GATE-LOCAL data, because a row for it in `phasedata.ts` would break
        PD-ROW-SOURCED's bijection - Pb is not a base metal here. Over the app's own 16 eutectic
        rows the ordering lever <= Scheil holds at all 624 sampled compositions, both monotone in
        composition, and the five peritectic rows are asserted EXCLUSIONS that refuse the
        fraction by name, so a predicate that silently swallowed them could not pass.
      - **Both polarities, over shipped presets — and the census moved once the review landed.**
        Before it, four presets emitted a `notGrown` line (A356, A356+TiB, 1045, 4340) and five
        were silent. After the Scheil repair below, **seven emit a line and two do not**: the
        four above on equilibrium grounds, plus AA2024, AZ91 and the galvanising bath on
        NON-equilibrium ones, against IN718 (0.008 %, below the floor) and tin bronze (a
        peritectic row, where the Scheil branch does not apply). Both polarities survive, so
        neither a classifier stuck on SINGLE-PHASE nor one stuck on TWO-PHASE can pass. Two of
        the three new lines are worth naming: **AA2024's 4.4 wt% Cu is under Al-Cu's 5.65 wt%
        equilibrium limit** and **AZ91's 9 wt% Al is under Mg-Al's 12.9 wt%** — so equilibrium
        genuinely says single-phase, and Gulliver-Scheil says 8.8 % and 11.9 % of a second phase
        anyway. Both statements are now printed together, which is the honest answer and was the
        plan's own wording for regime I. The solubility limit is quoted AT the invariant
        temperature and there is no solvus below it, so what precipitates on further cooling is
        outside both the drawing and the solver, and the SINGLE-PHASE sentence says exactly that
        rather than implying the casting is clean.
      - **`notGrown` rides the caveat channel P1 built**, so it renders OUTSIDE the modal: an
        `#alloy=` deep link and a `#set=` share link both now carry "roughly 49 % of this casting
        freezes at the 577 C eutectic and this solver grows none of it" to a recipient who never
        opens the composer. That is the most important honesty line the composer has - the
        difference between drawing a diagram and simulating one - and it was the one thing a
        shared melt could not previously say.
      - **The slider step changed for exactly one pair, and the comment beside it was wrong until
        the probe ran.** The bound's step is computed from the SMALLER of cap and ceiling, which
        for Fe-C moves 0.05 -> 0.01 (a cap of 2 gave it coarse steps; a 0.52 wt% carbon range
        deserves fine ones, and 1045's 0.45 and 4340's 0.40 both land on a step). The first
        version of that comment asserted "identical for all twenty-five" from reasoning rather
        than from measurement, and the measurement contradicted it on the first run.
      - **Two gate-quality self-catches, both now rules in `tasks/lessons.md`.**
        `verify-regimes.mjs` produced **zero output** against the pre-change tree: an unwrapped
        `PD.shortPhase` threw at the top of block one and took the other four gates with it,
        which in a log is indistinguishable from a gate nobody wrote. Each gate now runs inside
        its own try/catch, and `PD-CAP-CEILING`'s postcondition is stated over `derive()` alone
        so that against the old tree it fails with "33.2 wt% Cu survived into the derivation" for
        all 25 pairs rather than "soluteBound is not a function". And a doc claim was WITHDRAWN
        before it shipped: "the page contains the number of pairs the ceiling binds" recomputes
        5 and is satisfied by "35 wt%", "1045 steel" or "0.5" - a claim the page cannot fail.
      - **A PRE-EXISTING FLAKE, FOUND BY THIS MILESTONE'S SUITE RUN AND NOT CAUSED BY IT.**
        `STEP3-REGION` in `verify-3d.mjs` failed once with `regionCount 13, cpuCount 13` - the
        grain SETS agreed and a per-grain voxel count did not. Re-run five times on this tree it
        passed 5/5, with grain counts of 12, 12, 21, 10 and 19: that block runs an unseeded lab
        cast with 500 inoculant sites, polls to `fracSolidOpen >= 0.99` rather than 1.0, and then
        compares a GPU `readRegion` against a CPU recount of a DIFFERENT readback - so the
        casting is still freezing between the two reads. Nothing in P3 touches sim3d. Recorded
        rather than fixed: it is a gate timing defect with its own scope, and it is named here so
        the next person who sees it does not spend the afternoon looking in the wrong module.
      - **THE ADVERSARIAL REVIEW REWROTE THE PHYSICS OF THIS MILESTONE, AND THE FIRST VERSION
        SHIPPED A FALSE STATEMENT ON BOTH STEEL PRESETS.** Six independent lenses over the diff
        returned 44 findings; four of the six converged on the same defect without seeing each
        other's work, which is the strongest signal this arc has produced.
        - **Reactant-peritectic end states were simply wrong.** For a peritectic whose base
          solid is a REACTANT the classifier treated C_SM as the only boundary, so every
          composition from C_SM to C_inv was labelled "equilibrium ends this casting with
          gamma-austenite beside the iron". That is true only up to the reaction's PRODUCT
          composition. Above it the peritectic consumes ALL of the base-rich solid: Fe-C is
          L(0.53) + delta(0.09) -> gamma(0.17), so a 0.45 wt% C melt has its delta entirely
          eaten and the casting ends 100 % austenite with no ferrite anywhere. **1045 and 4340
          are both above 0.17, so both shipped presets printed a phase that is not in the
          casting.** Fixed by adding `Csecond` to the five reactant-peritectic rows — four
          numbers, each transcribed from the sentence that row's own `second`/`source` already
          states, with `PD-PRODUCT-SOURCED` asserting each value appears in its own prose — and
          by teaching `derive()` that a consumed primary is not present whatever the OTHER
          binaries in the mix say about it. 1045's two columns now read **gamma-austenite**
          against **(Fe)**: the solver grows a phase the casting does not end with, which is the
          sharpest sentence in the milestone and it took a review to find it.
        - **The peritectic refusal named the wrong mechanism.** It said the lever rule and
          Gulliver-Scheil "describe a liquid freezing to two solids, and neither describes a
          liquid and a solid reacting to make a third phase". False on both halves: the lever
          rule is a tie-line mass balance that knows nothing about reaction type and is exactly
          how the extent of a peritectic is computed, and Scheil is the standard tool for hypo-
          and hyper-peritectic steel. **By this repo's own doctrine that is a wrong statement
          rather than an absent one.** The real reason is a property of the QUANTITY: at a
          eutectic every drop of remaining liquid freezes AT T_inv, so the liquid fraction there
          IS the share that freezes at the invariant; a peritectic consumes only part of it and
          the rest freezes BELOW T_p on the product's own solidus. Replaced everywhere, and
          `PD-INVARIANT-BAND` now BANS the retired sentence from returning.
        - **Regime I was not honest about itself — a plan requirement this milestone missed.**
          The plan said "equilibrium says single-phase, Scheil says a real fraction freezes as
          eutectic anyway, and this solver grows neither"; the implementation evaluated Scheil
          on only one side of C_SM. So AZ91 at 9 wt% Al reported plain SINGLE-PHASE against a
          12.9 wt% limit while the module's own formula predicts **11.9 % beta-Mg17Al12 — the
          textbook as-cast constituent of AZ91**. AA2024 gives 8.8 %, the galvanising bath
          1.5 %. Now printed, with `SCHEIL_FLOOR` measured before it was chosen: the shipped
          compositions run 11.9 / 8.8 / 1.5 % and then fall to 0.75, 0.011, 0.008 and eight
          rows at 0.000 %, and the floor sits in that gap at 1 % because PD-CONSTRUCT-AGREE
          measures the two tables disagreeing about k by ratios from 0.68 to 3.30 — a predicted
          fraction of a few thousandths is below what the inputs can support.
        - **A fourth route past the ceiling, and the only one that reached the kernel.** A
          pre-P3 `#set=` share link restores the mix CLAMPED and then `Object.assign(sim.params,
          shared.p)` writes the minter's own c0/mLiq/kPart — so a link minted from a 3 wt% carbon
          melt showed 0.52 wt% in every readout and ran the cast iron in the solver. Closed by
          having `decodeMix` report WHICH elements it clamped as a list rather than leaving
          main.ts to match on a sentence, and re-deriving the chemistry only when it did — the
          condition matters, because overwriting unconditionally would break the legitimate case
          P1 already handles, a c0 slider moved after the pour.
        - **Four more, each real.** `phasesFor` narrated ni-W — the row `phasediagram.ts`
          REFUSES to draw as geometrically impossible — with confident phase names and a lever
          fraction, so the refusal now covers the CLAIM as well as the picture (and repairing it
          opened a hole: refusing to classify the row also switched its ceiling off, so 45 wt%
          tungsten sailed in until the bound was decoupled from the classifier). The share-link
          clamp said "at or past the invariant" for weights between the slider bound and the
          invariant, which is a mechanism that did not fire. `Array.sort` was mutating `entries`
          IN PLACE to build a display name, silently reordering the phase list built from the
          same array. The curator annotations inside `reaction` — "[base solid is a REACTANT]" —
          were being interpolated verbatim into user-facing prose.
        - **Three counting errors of my own, all of the same kind.** "Five of the shipped rows
          are peritectics" — there are SEVEN, and the two omitted (Fe-Mn, Fe-Ni) are precisely
          the rows where the classification defect above was live; the number was copied from
          the plan rather than counted from the table, and it had already been published to
          `science/index.html`. `shortPhase`'s docblock claimed "24 rows, one changed" from a
          measurement taken BEFORE the rule existed: it is 23 rows, and the rule fired on ni-W's
          "(W)" too, relabelling it "(W) bcc" — parentheses are now the test, so a symbol that
          is already a complete phase name is left alone. And "roughly 49 % of it freezes at the
          eutectic" put the nearest antecedent on the second phase rather than on the casting.
        - **Refuted, and worth recording as refuted:** roughly two-thirds of the 44 findings did
          not survive their three refuters. The convergence was on the peritectic end state
          (four lenses), the peritectic count (three) and the ceiling escape (two).
      - **One review finding recorded rather than fixed, and it belongs to P6.** `notGrown` now
        rides the caveat channel to `#matcaveat`, the amber strip over the canvas corner, so a
        deep link carries the honesty line to a recipient who never opens the composer — which
        is the point of putting it there. It is also long: 1045's line plus its clamp runs about
        400 characters, roughly five lines at that strip's 10 px / 520 px box. Truncating an
        honesty statement mid-sentence is worse than a tall one, and P6 owns the front door and
        the tour, so this is left as a named UI debt rather than repaired with a line-clamp here.
      - **Suite.** 23 scripts, **159 checks**, zero failures, seven pages clean, exit 0 — up
        from P2's 22 / 153 by `verify-regimes.mjs`'s five checks and `PD-PRODUCT-SOURCED`. One
        run in the middle of this milestone reported `STEP3-REGION` failing in `verify-3d.mjs`;
        re-run five times in isolation it passed 5/5 with grain counts of 12, 12, 21, 10 and 19,
        because that block runs an unseeded lab cast and compares a GPU `readRegion` against a
        CPU recount of a DIFFERENT readback while the casting is still freezing. A pre-existing
        gate-timing flake, named here so the next person to see it does not go looking in
        `alloy.ts`. A second run failed on `verify-phasediagram-gpu.mjs` with "Execution context
        was destroyed" — that one was mine: I edited `src/composer.ts` while the suite was
        running and vite hot-reloaded the page out from under the gate.
      - **Docs, in this commit rather than deferred to P6.** `science/index.html` gains its two
        rows - the phases row (two columns, both fractions, the peritectic refusal, the solvus
        caveat) and the regime row (where the ceiling is derived from, the five binding pairs,
        and cast iron leaving by construction) - and `PD-DOC-CALIBRATION` grows from 12 gated
        claims to **21**, every one recomputed from the modules, so this milestone's prose is
        gated by the commit that writes it. `TESTING.md` ten -> **eleven** in all three places
        against exactly eleven `- run:` lines in `ci.yml`. `README.md`'s composer bullet gains
        the two columns and the cast-iron removal.

- [x] **P4 — the element dataset and the tier classifier, with no UI.**
      Split off from the grid on the C0b/C0c precedent, so a suite failure in the P5 window has one candidate cause rather than five.
      - **New `src/elements.ts`:** 118 rows of `{ symbol, Z, mass, radiusCN12, chiPauling, Tm, Tb, dHvap, primordial, block, source }`. Radii are Teatum CN12 metallic radii; electronegativities are Pauling; T_b and ΔH_vap from standard thermochemical tables, cited in the file header and per-block in `source`.
      - **`admit(base, element, wt)` returns exactly one of four tiers.** NOT-A-SOLUTE (element-level, base-independent): noble gases (closed shell, no metallic bond); halogens (ionic salts and volatile halides — fluxing agents, not solutes); non-primordial Tc, Pm, Po, At, Rn, Fr, Ra, Ac, Pa and everything Z > 92; and **H, N, O only** as GAS-SPECIES, whose refusal names Sieverts' law and points at the hydrogen porosity layer *only for materials carrying `hL`/`hS`*. REFUSED-PAIR with distinct sub-reasons NO-ASSESSMENT / NOT-CHECKED-FOR-DEMIXING / DEMIXES / PAST-THE-INVARIANT. OUTSIDE-THE-MODEL: real casting chemistry the solver structurally cannot carry — monotectics, intermetallic refiners past their invariant. ASSESSED: the pair has a cited `Solute.source` **and** a cited `phasedata` row, which after P0 is exactly the 25 shipped pairs.
      - **S and P leave the gas tier.** Sieverts' law is the √p solubility law for diatomic gases; sulphur and phosphorus are dissolved solutes obeying dilute-solution thermodynamics with well-measured slopes and partition coefficients in iron, and they are the canonical low-k segregators — the physics this solver models best. Pointing a user at `porosity.ts` for sulphur would point them at a layer that models hydrogen only. They are refused for the honest reason (no cited coefficient row entered yet) with a distinct string, and adding them as cited Fe solutes is named here as the best single future addition. Nitrogen is kept in the gas tier but its string says it is also a deliberate addition in N-strengthened stainless, which this composer does not carry.
      - **Interstitials are exempt from the size rule.** C, N, B are screened by Hägg's r/R < 0.59 criterion, not by Hume-Rothery's 15 %, which returns a meaningless dR = −39.6 % for the canonical Fe–C pair. Alkali and alkaline-earth elements are handled per base by the computed vapour rule, **not** blanket-refused as a class: Na and Sr are the standard Al–Si eutectic modifiers at 0.005–0.02 wt%, Ca is a real Mg addition and steel-ladle desulphuriser, and Li over Al computes well under 1 atm (Al–Li at 1–2 wt% is flight hardware).
      - **The vapour rule is an ADVISORY, never a refusal.** p_i = x_i·exp(−ΔH_vap/R·(1/T − 1/T_b)) at the base's liquidus reproduces foundry practice from two tabulated numbers per element — Zn ≈ 59 atm over liquid Fe (why galvanised scrap is barred from the charge), Mg ≈ 16 atm (the ductile-iron nodularising plunge), Mn ≈ 0.037 atm (the welding-fume hazard, correctly a warn and not a refusal), Hg ≈ 39 atm over liquid Al. Applied as a refusal it would refuse Cu–30Zn at ~1.4 atm, and real brass exists because Cu–Zn has ΔH_mix ≈ −6 kJ/mol and an activity coefficient this app does not have. The printed line names that missing number out loud.
      - **Gates.** `EL-TIER-TOTAL` (browser-free) — totality over 6 bases × 118 elements = 708 pairs: each resolves to exactly one tier, none unclassified, none multiply classified; every non-ASSESSED pair carries a reason > 25 chars; the DISTINCT reason set size ≥ 12 so 700 refusals cannot collapse into one generic sentence; NOT-CHECKED-FOR-DEMIXING and NO-ASSESSMENT are asserted to be **different strings**, because a refusal that names the wrong mechanism is a wrong statement, not an absent one; every advisory line contains its own computed pressure in atm and every PAST-THE-INVARIANT line its own wt%. Liveness: the ASSESSED count per base is > 0 and the total equals the number of pairs holding both a cited `Solute.source` and a `phasedata` row. `EL-TROUTON-CROSSCHECK` (browser-free) — ΔH_vap/T_b for every element carrying both fields, flagged against Trouton's rule (~85–110 J/mol·K for normal liquids; the associated liquids that legitimately fall outside are enumerated by name with their own source line). This replaces the originally-planned fixed-point check, which was a tautology: p(T_b) = exp(0) = 1 for **any** ΔH_vap including a decimal-slipped one, so a Zn entry of 11.5 instead of 115 kJ/mol would have passed while silently turning 59 atm into 1.5 and reversing the teaching. Liveness: > 80 elements carry both fields. `EL-VAPOUR-ADVISORY` (browser-free) — the four pinned drift tripwires above in the `verify-porosity.mjs` idiom, **values measured on this tree and recorded here before they are pinned**, plus the direction that would be a bug: Cu–30Zn is asserted NOT refused and its printed line is asserted to name the missing activity coefficient. `ALLOY-MOVES-THE-PHYSICS` (browser-free) — the replacement for the deleted bundle-delta metric. For every ASSESSED pair added at `min(1 wt%, Csm/2)`, the **unclamped** sums move: |m_i·c_i| > 0 and the mix's ΔT_L or Q changes by more than a floor measured over the assessed set first. Beside it, a named CLAMP-SWALLOWS report listing every pair whose contribution the shipped c0 floor or mLiq ceiling makes invisible to the solver at trace level — Al–Ti at 0.075 wt% measures **0.0000** bundle movement today, and that is a finding worth printing, not a gate that cannot go green. Liveness: the pair count tested equals the ASSESSED count from EL-TIER-TOTAL.
      - **Risks.** The demixing list (Cu–Pb, Al–Bi, Al–In, Al–Pb, Fe–Ag) is hand-entered and fails open; it is labelled as the systems that have been CHECKED, never as the complete set, and unlisted monotectics take the NOT-CHECKED string rather than being refused for the wrong mechanism. Miedema ΔH_mix is not used: its sign gives neither a gap temperature nor a gap composition and the scheme overestimates dilute liquid excess enthalpies by ~25 %, so it would put an inferred refusal on screen where a cited one is available.
      - **Docs.** `TESTING.md` gains the EL- family. `science/index.html` gains the admissibility row: the input chemistry opened to the periodic table while the output to the solver stayed a one-channel pseudo-binary, and the dilute superposition assumes zero solute–solute interaction — which is exactly what an open table invites users to violate.

      - **DONE 2026-08-16.** `src/elements.ts` lands 118 rows and `admit(base, element, wt)`;
        `scripts/verify-elements.mjs` lands SIX gates, not the plan's four. Nothing imports the
        module yet — confirmed by grep against `dist/assets/*.js`, where no chunk contains a
        byte of it — so P4 ships a pure layer that CI gates and P5 wires, on the C0b/C0c
        precedent. The suite goes 23 scripts / 159 checks to **24 / 169**, zero
        failures, seven pages clean, exit 0.
      - **The tiers, measured over all 708 pairs.** NOT-A-SOLUTE 282 (47 elements x 6 bases,
        asserted base-INDEPENDENT in both tier and reason), REFUSED-PAIR 396, ASSESSED **25**,
        OUTSIDE-THE-MODEL 5. The assessed count is not written down anywhere: `EL-TIER-TOTAL`
        recomputes it as the number of pairs holding both a cited `Solute.source` and a
        `phasedata` row and requires the classifier to agree, so "this milestone adds no new
        pourable chemistry" is a gated claim rather than an intention. Every one of the 708 is
        also driven through `derive()`, and ASSESSED must hold if and only if the pour is
        accepted — an admission and a pour cannot drift apart.
      - **Three places the plan was wrong, and the reasons.** (1) It listed DEMIXES and
        PAST-THE-INVARIANT as REFUSED-PAIR sub-reasons and then defined OUTSIDE-THE-MODEL as
        "monotectics, intermetallic refiners past their invariant" — the same two things.
        Grouped the plan's way OUTSIDE-THE-MODEL has no members and is a tier that exists only in
        a comment; they are placed by the definition instead. (2) It ordered the base-independent
        refusals noble-gas first, non-primordial last. Reversed here, because for Rn, At, Og and
        Ts the availability statement is a measurement and the chemical one is an inference from
        a position in the table — "tennessine forms ionic salts" is a claim nobody has tested,
        and "it is not primordial" is simply true. (3) Its probe composition, min(1 wt%, C_SM/2),
        contradicts its own worked example: Al–Ti's C_SM is 1.32 wt%, so half of it is 0.66,
        which is four times PAST the 0.15 wt% invariant this instrument refuses to cross. The
        0.075 wt% the plan quotes is C_inv/2, and that is what `probeWt` computes.
      - **A fourth thing the plan did not consider: the diagonal.** `admit("al","Al",…)` is
        not a composition, and none of the four sub-reasons covered it. IS-THE-BASE is a fifth,
        and it answers usefully — "the melt is already aluminum; this composer carries Al as a
        solute in nickel, magnesium and zinc."
      - **The vapour rule reproduces the plan's four literature numbers from two tabulated
        values per element**, which is the strongest evidence available that the table is right:
        Zn **59.39 atm** over liquid Fe, Mg **16.35**, Mn **0.0373**, Hg **39.25** over liquid
        Al, and Cu–30Zn at **1.367 atm** — against the plan's 59, 16, 0.037, 39 and ~1.4,
        written before any of this existed. It is an ADVISORY: applied as a refusal it refuses
        brass, so `EL-VAPOUR-ADVISORY` asserts Cu–30Zn computes above one atmosphere, stays
        ASSESSED, and names the activity coefficient the app does not have.
      - **`EL-TROUTON-CROSSCHECK` replaces a tautology, and the plan said so.** p(T_b) = exp(0) =
        1 atm for ANY enthalpy, so the fixed-point check first planned for this slot could not
        see a decimal slip. Zinc at 11.5 kJ/mol instead of 115 turns 59 atm into 1.5 — still
        BOILS, still self-consistent, teaching the opposite. Driven as a mutation it now fails
        **three** independent checks - the Trouton crosscheck, the pinned vapour tripwire and
        the doc gate, since `science/index.html` quotes the pressure too. (An earlier draft of
        this line said four, counting the run's own "done - N FAILED" summary line as a gate.) Of 96 rows carrying both T_b and ΔH_vap, 43 sit inside 85–110
        J/mol·K and 53 do not; each of the 53 is pinned BY VALUE to ±1.5 and must explain
        itself with a `TROUTON:` clause in its own source, so the enumeration cannot rot into an
        unread allow-list.
      - **CLAMP-SWALLOWS, printed rather than gated green.** Every assessed pair moves the
        unclamped liquidus by at least 1.0 K at its probe composition (floor set at 0.5, half the
        measured minimum), but two move the solver's own (c0, mLiq, kPart) triple by exactly
        **0.0000**: Al–Ti at 0.075 wt% and Mg–Zr at 0.29 wt%, both grain refiners, both
        moving ΔT_L by 2.3 and 2.0 K and Q by 18.4 and 11.0 K. The plan predicted Al–Ti and
        not Mg–Zr. d_Sol is deliberately outside the triple: it moves for any solute whose
        dRel differs from 1 whatever its m, k or c, so including it would mask the case the
        report exists to find.
      - **The review rewrote the data, and one defect was invisible to all six gates.** Eight
        independent audit agents over the table and the classifier returned **52** findings. The
        sharpest: the CN8→CN12 metallic-radius correction had been applied to the s-block bcc
        rows and forgotten on the d-block ones, so V, Cr, Nb, Mo, Ta, W and Ra carried the
        nearest-neighbour radius a·√3/4 — while the file's own source string said in as
        many words that they did not. W and Re both reading 137.1 pm was the tell; Re is hcp, so
        137 is genuinely its CN12 value and the coincidence existed only because W was
        uncorrected. Nothing could catch it, because the radii were only ever checked against
        themselves. `EL-TABLE-SHAPE` now ties the column to the density through the
        close-packed-equivalent radius r = (0.7405·3M/4πρN_A)^⅓; reverting W, Cr or
        Nb to CN8 fails by 2.8–2.9 %. The ten rows that legitimately miss are pinned by
        MEASURED value with their structure named — α-Po at 12.7 %, the only simple-cubic
        element; α-Pu at −6.5 %, the least symmetric metal known — and the first draft
        of that pin list was written from intuition rather than measurement and was rejected by
        the gate, which is the correct order of events happening the wrong way round first.
      - **Nine more corrections the audit forced, each a claim this file could not stand
        behind.** Bismuth was called "the heaviest primordial element" two rows above thorium and
        uranium, which this same table marks primordial. Al–Bi's monotectic was said to sit "a
        few degrees above pure aluminium's melting point" — 657 °C against 660.3, and it
        cannot be above, because the monotectic is where the falling (Al) liquidus meets the gap.
        The Trouton explanation "per mole of the species that actually leaves the liquid it sits
        inside the window" is false for H2 (45), N2 (72), O2 (76) and F2 (77); the rest is that
        Trouton's band was fitted near 300–400 K, and 36.6 + R·ln T_b returns 72.8 for
        nitrogen against a measured 72.1. "A quantum liquid" was applied to argon, the textbook
        CLASSICAL Lennard-Jones liquid. The Z > 92 refusal said "only ever been made in
        accelerators, in quantities from a few atoms to a few micrograms" — false three ways
        for plutonium, which occurs in trace naturally, is reactor-bred, and exists by the tonne,
        with δ-phase Pu–Ga a documented casting alloy. The oxygen refusal told a copper
        user that oxygen "does not stay dissolved", when tough-pitch copper carries 0.02–0.05
        wt% on purpose and oxygen content is what separates C10100 from C11000. The nitrogen
        refusal quoted Sieverts' law over aluminium, where nitrogen does not dissolve but reacts
        to AlN. The Hägg branch hardcoded "which is why Fe3C is a complex orthorhombic
        carbide" into a sentence printed for **every** interstitial pair over the limit — so a
        boron addition to aluminium was answered with a fact about cementite — and blamed the
        meaningless substitutional number on the two radii coming from different conventions,
        which cannot be the reason, since the Hägg ratio one clause earlier divides exactly
        the same two radii and is the number that branch trusts. And the NEGLIGIBLE band, the one
        place the ideality caveat is deliberately dropped, claimed "no activity-coefficient
        correction could lift a number this small" — falsified by an example inside this app:
        lead in iron at 1 wt% computes 7.8e−4 atm while γ°(Pb in liquid Fe) is of order
        100–1000, which puts it in or above the fume band. The claim is now made only below
        1e−4 atm, where a hundredfold correction still cannot cross the threshold.
      - **And one the classifier lens found that the tier gate could not.** `admit()`'s docblock
        promised it could never disagree with `derive()`, and it carried only the ceiling test
        while `derive()` refuses four more things: a non-finite weight, a negative one, one over
        100, and it drops a zero. `admit("fe","Cr",NaN)` came back ASSESSED with an advisory
        reading "Cr at NaN wt% exerts 0.0e+0 atm, which is negligible" — `moleFraction`'s
        `n + nb > 0 ? … : 0` guard swallowed the NaN into a clean-looking zero. The gate
        missed it because the gate drove only probe weights. NOT-A-COMPOSITION is a sixth reason,
        the gate drives NaN / Infinity / −1 / 101 on three pairs, and no advisory line may
        contain the string "NaN" anywhere — a weight that cannot be poured is now DESCRIBED
        ("that weight is not a number at all") rather than echoed.
      - **Gates, and what each one fails on.** Six, all reporting on a tree without
        `src/elements.ts` — the module LOAD is guarded, which `verify-regimes.mjs`'s is not:
        P3 wrapped each gate in `block()` after an unwrapped call produced zero lines of output,
        and this milestone found the level above, where `ssrLoadModule` throws before any block
        runs. That is precisely the tree a non-vacuity proof is run against, so the hole was in
        the one place it mattered. Behaviourally: a zinc decimal slip fails 4; collapsing every
        refusal to one template fails `EL-TIER-TOTAL` (31 skeletons → 1); a row out of Z order
        fails `EL-TABLE-SHAPE`; deleting the weight guard fails `EL-TIER-TOTAL`; reverting a bcc
        radius to CN8 fails `EL-TABLE-SHAPE`.
      - **The distinctness clause the plan asked for is vacuous, and was replaced.** "The
        DISTINCT reason set size ≥ 12" is satisfied trivially when every sentence interpolates
        its own element and base: measured on this tree the naive count is 488 of 708, and it
        would pass a file that said "X is not available in Y" seven hundred times. What is
        counted instead is the sentence SKELETON, with base labels, element symbols and every
        number replaced — **31** of them — and no two REASONS may share one, because a
        refusal naming the wrong mechanism is a wrong statement rather than an absent one.
      - **Docs, in this commit.** `science/index.html` gains the admissibility row and three
        paragraphs — the tiers and their counts, the vapour rule with its four numbers and its
        refusal to be a refusal, and the limit this milestone makes easier to violate: the
        composer sums solutes with ZERO solute–solute interaction and collapses them onto one
        pseudo-binary, which is exactly what an open table invites a user to break. A new
        `EL-DOC-CLAIMS` gate holds 16 of those numbers against the modules, tags stripped and
        typographic dashes flattened so it cannot fail on typography, and no claim allowed to be
        a bare small integer. Writing it caught two of my own: "93 of the 118 columns have no
        coefficient row" conflated per-base with per-element (16 of 118 elements carry one in any
        base at all), and the Darken–Gurry count is now marked as measured offline, since the
        ellipse is deliberately not in the code and nothing in the build re-derives it.
        `TESTING.md` eleven → **twelve** in all three places, against exactly twelve `- run:`
        lines in `ci.yml`.
      - **Open, and named rather than fixed.** `chiPauling` is carried by all 118 rows and read
        by nothing — electronegativity difference is the OTHER Hume-Rothery rule, the
        electrochemical factor, and this file applies neither as a gate; the header says so
        rather than letting a reader discover that a tabulated column decides nothing. A row's
        own `Tm` is likewise never read, since the vapour rule takes its temperature from the
        BASE. Gold and holmium sit on a 6 % compilation split (342 vs 324, 265 vs 251); both
        rows carry the value and the alternative, and holmium's choice decides whether it is a
        Trouton outlier at all. Manganese's radius has no single right answer — α-Mn has
        four inequivalent sites spanning 1.24–1.45 Å — and the row names the spread
        instead of averaging it away.
      - **A SECOND review ran over the finished milestone, and 28 of its 56 findings survived
        refutation.** Five lenses — gate strength, the repairs the first audit forced, the prose,
        integration, and a contrarian — then one refuter per finding, told to default to
        REFUTED. What survived was worth the pass, and the sharpest two were both gates that
        could not fail.
        **(1) The base-sensitive sentences were pinned by nothing.** One token —
        `N_DISSOLVES = ["fe","ni"]` → `["ni"]` — makes iron print "in iron / steel not for the
        Sieverts reason that applies in steel: its solubility here is essentially nil", which is
        self-contradicting and false, and ALL SIX GATES stayed green: the skeleton count did not
        move, because nickel still populated the other template, and every one of those sentences
        carries the same reason, so the cross-reason check never compares them. A count cannot see
        a swap between two populated branches. Twelve cells are now pinned by branch, each with a
        marker it MUST carry and one it must NOT — and writing that check caught its own first
        version, which asked fe-N for `/Sieverts/` and was satisfied by the failing branch, whose
        text is "not for the SIEVERTS reason that applies in steel".
        **(2) `safeFromGamma` carried a magic 1e-4** that means "the fume threshold divided by the
        hundredfold correction the sentence claims for itself". Moved to 1e-3 every gate stayed
        green while the app printed "even a hundredfold correction leaves this under the 0.01 atm
        threshold" about a pressure eight times over it. `FUME_ATM` and `GAMMA_HEADROOM` are now
        exported, the cutoff is derived from them, and the gate asserts the RELATION.
        The rest: `EL-DOC-CLAIMS` was the one gate not wrapped in `block()` and the only one that
        touches the filesystem; its monotectic claim was a joined list compared with
        `includes()`, satisfied by any PREFIX of itself, so dropping a row passed; the Hägg
        limit could be moved from 0.59 to 0.90 with everything green, because the page carried the
        literal and nothing tied them; `/TROUTON:/` was a bare prefix test that an empty clause
        would satisfy; `tested !== assessed` compared a count with a recomputation of itself and
        could not fire; and the per-pair physics assertions were nonzero tests, so every
        coefficient in `alloy.ts` could drift together and pass — the SUMS are pinned now.
      - **And it found three more claims that were wrong, one of them refuted by this file's own
        arithmetic.** `T_HIGHBOIL` said the boiling-point trend explains the elements above the
        Trouton window; the Trouton–Hildebrand–Everett form 36.6 + R·ln T_b tops out at
        108.75 J/mol·K for rhenium, the highest-boiling row in the table, against a measured
        138 for tungsten — so it explains part and the row now says the excess is real and
        unexplained rather than naming a mechanism that does not reach. Neon was carried as a
        quantum liquid and is not one: its 63.2 is within a joule of what the boiling-point
        correction alone predicts, while helium's 19.6 against a predicted 48.6 is what a genuine
        quantum liquid looks like. And `MOLECULAR_VAPOUR` omitted tellurium, which printed a
        fume-band number on three bases from an enthalpy half the size the exponent needs.
      - **Three numbers I had written down were wrong, and all three were mine.** The naive
        distinct-sentence count is **488** of 708, not 422 — it moved when the audit's repairs
        rewrote the sentences and I quoted the pre-repair measurement. The zinc decimal slip fails
        **three** gates, not four; the fourth was the run's own "done — N FAILED" summary line,
        counted by a `grep -c FAIL`. And "at most 3 %" for the liquidus-versus-melting-point cost
        is a claim over a population of ONE — Cu–Zn is the only assessed pair whose pressure
        even reaches the fume band — which the prose now says instead of implying a survey.
      - **Named and NOT fixed, because they are not P4's.** The twelve browser-free gates do not
        run in CI on this branch at all: `.github/workflows/ci.yml` fires on `push` to `main` and
        on `pull_request`, and this arc lives on `v7-experiments`. That has been true since P0 and
        it is a repo-policy call rather than a milestone's, so it is recorded here rather than
        changed unilaterally — but "CI gates this" is weaker than it reads for every milestone
        in this arc until the branch is PR'd. Separately, the density cross-check reaches 75 of
        the 118 rows; the covalent radii it cannot reach have no independent check at all, which
        is a known hole in the newest gate on the day it shipped.
      - **A pre-existing gate fragility, diagnosed rather than left as "a flake".** One suite run
        mid-milestone failed `STEP3-ORDER` in `verify-3d.mjs`; three isolated re-runs passed, and
        so did the final one. The mechanism is now legible in the data rather than mysterious:
        `maxFreeze` saturates at the cast's TERMINAL timestamp for any section that has not
        finished freezing, and the check compares the thinnest section against the thickest. The
        two thickest read an IDENTICAL value on every run including the passing ones
        (0.6217/0.6217, 0.5584/0.5584, 0.5722/0.5722), so the check passes only when the THIN
        section finished; on the failing run 13, 35 and 49 all read the same 0.5524 and the
        assertion `ps[0].maxFreeze < ps[3].maxFreeze` went false on equality. It joins
        `STEP3-REGION` as a timing fragility in the same block, and it cannot be P4's: nothing in
        this milestone is imported by the app, which a grep of `dist/assets/*.js` confirms. (Two
        of those re-runs died with "Execution context was destroyed" - my own fault again and the
        same way as at P3: review agents were editing `src/` while a GPU gate drove a vite-served
        page. Sequence the review AFTER the suite, not beside it.)
      - **Two notes P5 should read before it starts.** A grid that colours cells at a fixed 1 wt%
        will paint Fe–C, Al–Ti and Mg–Zr as OUTSIDE-THE-MODEL, because 1 wt% is past all
        three ceilings (0.53, 0.15, 0.58) — it must colour at each pair's own `probeWt`, or three
        of the twenty-five assessed pairs will read as refusals on first paint. And `Admission`
        carries a paragraph, not the one-line reason P5's plan asks the grid to show; deriving one
        is P5's, and it should come from the classifier rather than from a truncation, or the
        sentence that gets cut will be the half carrying the number.

- [x] **P5 — the periodic grid opens in the composer, and every refusal names its own number.**
      Ask #2, in the only shape that never prints a number the instrument cannot defend: the refusals **are** the content. A visitor who clicks Hg over aluminium and reads "mercury boils at 39 atm over liquid aluminium — the melt cannot hold it" has learned more metallurgy than one who simply cannot see mercury, and switching the base from Al to Fe visibly reddens Zn, Mg, Cd, Na, K and Ca as the liquidus climbs past their boiling points. That base switch is a good capture for `scripts/capture-demos.mjs`.
      - **`src/composer.ts` replaces the closed "+ add element" select with a 118-cell grid** coloured per tier for the currently selected base, with a one-line computed reason. The assessed-only quick list stays in place and the grid appends after it, so the modal still works at 94vw where an 18-column grid is ~19px cells; the reason is tap-to-select, not hover-only. Base switching is a class swap over static markup, not a rebuild. **The base set stays at six.**
      - **Gates.** `ALLOY-OPEN-IDENTITY` (browser-free) — the keystone. All 9 presets and all 25 legacy pairs derive a byte-identical `{alloyOn, c0, mLiq, kPart, dSol}` bundle and an identical `clamps[]` array against a reference hardcoded from the pre-P5 tree. Liveness, because A === B is trivially true for two zeros: each arm separately proven alive (c0 > 0, 0 < kPart < 1, dSol > 0, non-empty solute entries, non-empty generated name). Difference half, which catches the harness: a deliberately perturbed control mix produces a DIFFERENT bundle, so a comparator that always reports equality fails. Third clause: ≥ 1 refusal is proven to have fired somewhere in the open set, or the set never opened and the gate passed twice on nothing. `ALLOY-SHARE-PRE-P5` (browser-free) — the pre-arc corpus including the landing page's own `#alloy=al:Si7,Mg0.35,Ti0.12` (`index.html:485`) round-trips to byte-identical mixes and bundles, and `encodeMix` still emits the OLD tuple shape whenever no new-tier element is in the mix. `COMPOSER-GRID-PANEL` (GPU) — end-to-end through the DOM as a visitor drives it: open the composer, click an ASSESSED cell and assert the solute row appeared with the ceiling-aware default; click a refused cell and assert the named reason rendered and no row appeared; switch base Al→Fe and assert ≥ 1 cell changed tier **and** ≥ 1 did not. Both polarities, because a grid that refused everything would satisfy a presence-only check.
      - **Risks.** This milestone adds **no new pourable chemistry** — ASSESSED is exactly the 25 existing pairs — so its keystone gate is a non-regression gate by construction. That is honest and it is the point: the grid's new content is 93 elements of computed, sourced refusal. Existing GPU gates do not drive composer controls (grep of `scripts/*.mjs` finds only `window.__solidify.alloy`), so no positional selector breaks here, but P5's own panel gate is the first DOM driver written for the composer and it selects by stable `data-` attributes, not by index. Keep `phasedata.ts` and `elements.ts` out of anything `index.html`'s rewritten ACT 3 imports, or ~25 KB of chemistry rides the landing page's first paint for no reason; `dist/assets/landing-*.js` is a separate chunk today and must stay one.

      - **DONE 2026-08-16.** The composer's closed "+ add element" list keeps its place as the
        quick path to a base's six solutes, and underneath it the whole periodic table opens:
        **118 cells** in the 18-column layout, coloured per tier for the melt you are standing
        over, with a legend, a tap-to-select reason panel and no hover-only anything. Built ONCE
        in the constructor and repainted by attribute on a base switch — 118 attribute writes
        against 118 element creations, and the click handler is bound once and delegated, so no
        repaint can leave a stale handler that still believes it is tungsten. Measured, a base
        switch costs **1.8 ms** for 118 `admit()` calls, so no cache was added and the grid's
        colour and its reason come from ONE code path, which is what stops them disagreeing.
        The suite goes 24 scripts / 169 checks to **26 / 176**, and CI's browser-free set twelve
        to **thirteen**.
      - **The plan said "replaces the closed select" and also "the assessed-only quick list stays
        in place", and those cannot both be literally true.** Resolved toward keeping it: the
        `<select>` IS the assessed-only quick list, it is the keyboard-reachable path, and at
        94vw it is the compact one. The grid supersedes it as the primary affordance rather than
        deleting it. Written down because it is a deliberate reading of the plan and not an
        oversight.
      - **SIX gates, not the plan's three, and the extra three are claims the milestone makes
        that nothing else would hold.** `ALLOY-OPEN-IDENTITY` is the keystone and its reference
        was measured the hard way: a **pre-P5 worktree at da16b5f** was checked out, the same
        generator run against both trees, and the two JSON payloads compared BYTE FOR BYTE —
        because "I did not change `alloy.ts`" and "`alloy.ts` does not behave differently" are
        different claims and only the second is a gate. All 9 presets and all 25 legacy pairs
        derive an identical tuple and clamp list. Equality being trivially satisfiable, three
        clauses carry it: every arm separately proven ALIVE, a perturbed control (A356 with its
        silicon moved by a tenth of a per cent) required to DIFFER so a comparator stuck at
        "equal" fails, and the same mix with its keys reordered required to still MATCH so the
        comparator is not sensitive to something else. `Object.is`, not `===`, so a sign-flipped
        zero counts. `ALLOY-SHARE-PRE-P5` restores fifteen pre-arc links including the landing
        page's own published `#alloy=al:Si7,Mg0.35,Ti0.12`, and proves STRUCTURALLY that no cell
        can put a new symbol into a link. `GRID-LAYOUT-TOTAL` places 118 elements with no two
        sharing a cell, pins nineteen positions, and requires the DRAWING to agree with the
        `block` column — move lanthanum in one place and not the other and the build fails.
        `GRID-REASON-LINE` walks all 708 pairs. `LANDING-CLOSURE-CLEAN` walks the static-import
        closure from `src/landing.ts` and requires it not to reach the chemistry — deliberately
        the SOURCE closure and not a grep of `dist/`, because `npm test` does not build, so a
        bundle-reading gate would either fail on a fresh clone or be allowed to skip, and a gate
        that can skip is not a gate. `GRID-DOC-CLAIMS` holds **14 claims across two documents**,
        every expected value recomputed from the modules. **Four of the six FAIL against the
        pre-P5 tree** — GRID-LAYOUT-TOTAL, GRID-REASON-LINE, LANDING-CLOSURE-CLEAN and
        GRID-DOC-CLAIMS — verified by checking out da16b5f and running the final six there;
        the two that pass on both are the non-regression pair, which is what they are for. (The
        first count said three, taken before GRID-DOC-CLAIMS existed and never re-measured when
        it did.)
      - **The gate found a real defect on its first run, and it was mine.** The one-line reason
        for an assessed pair quoted `pdRow.Tinv` unconditionally, so Fe–Cr and Cu–Ni — the two
        pairs in this table soluble in every proportion — advertised themselves as "a cited
        isomorphous at **null °C**". The paragraph never had the bug because it names the KIND
        and not the temperature; the line reached for a number that does not exist, which is the
        one thing this file refuses to do everywhere else. `GRID-REASON-LINE`'s placeholder ban
        caught it before the panel was ever opened on those two cells.
      - **P4's two notes for this milestone were both real, and both measured.** A grid colouring
        at a flat 1 wt% paints **al-Ti, fe-C and mg-Zr** as OUTSIDE-THE-MODEL — 25 assessed
        pairs at each pair's own `probeWt` against **22** at 1 wt% — so carbon-in-steel would
        have read as a refusal the moment the panel opened. And `Admission` now carries a `line`
        written at each branch, never cut from `sentence`; "not a truncation" is checked
        mechanically, since no line may be a prefix of its own sentence.
      - **A fifth visual channel was added after looking at a screenshot, and a fourth was
        renamed for being false.** Iron sat greyed out in the middle of an iron melt looking like
        one more thing this build never got round to — its tier is genuinely REFUSED-PAIR, since
        "add Fe to iron" is not a composition, but the grouping said "no data" and it is not a
        data question. The base's own cell is marked. And the REFUSED-PAIR legend read "nothing
        entered", which is FALSE for six of its members for exactly that reason; it now reads
        "refused", which is true of all four of its reasons, and the line underneath supplies the
        mechanism, which is its job. The vapour band rides ALONGSIDE the tier rather than inside
        it, because zinc over iron is both an unassessed pair and a 59 atm fume and collapsing
        the two would lose the half a foundry notices — Al → Fe moves **14** tiers and puts a
        fume stripe under **10 more elements whose tier does not move at all**, which the GPU
        gate asserts as an independent channel.
      - **A P4 repair that was written down and never landed.** P4's second review found that
        `MOLECULAR_VAPOUR` omitted tellurium and recorded the fix in this ledger; the tree still
        printed 0.120 atm over iron, 0.088 over nickel and 0.011 over copper, all three inside
        the fume band, all three from a per-atom enthalpy for a vapour that is Te2 exactly as
        selenium's is Se2 — and selenium and arsenic were on that list from the first draft.
        Nothing failed, because no gate compares a claim in `tasks/todo.md` against the code it
        claims. The symbol is one token and it is fixed here rather than carried. **The P4 entry
        above is wrong on that one point and is left standing with this correction beside it**,
        which is the archive rule.
      - **`verify-tools.mjs` IS LOAD-FRAGILE IN TWO PLACES, and neither was loosened here.**
        Two full suite runs reached it and each failed a DIFFERENT check. `REFINE-FAIR` compares
        the refined and lean charges at matched solid fraction against a 15 % tolerance and
        measured **15.2 %**; three isolated re-runs measured 5.2 %, 9.9 % and 11.6 %, so
        the threshold sits inside the population's own tail rather than outside it. `ATMOSPHERE`
        requires the air pour to lead the vacuum pour by ≥ 40 fired sites and measured **0** —
        which is not a marginal miss but a run that never happened, since all four runs
        outside the suite measured **150**, a margin of nearly four times. Both pass in isolation, and both pass
        when `verify-optimizer.mjs` is run immediately before them exactly as the suite does, so
        it is not a state leak from the predecessor: it is machine load at the seventeenth script
        of twenty-six, in a check paced by `setTimeout` rather than by the condition it waits on.
        Neither is P5's. `verify-tools.mjs` drives `window.__solidify.lab` and the nucleation
        counter and never opens the composer; the only P5 code that executes on that page is
        `buildGrid`, which creates 118 buttons and calls no chemistry at all; and
        `ALLOY-OPEN-IDENTITY` proves the parameter bundle `REFINE-FAIR` feeds the solver for
        A356+TiB is byte-identical to the pre-P5 tree. The honest repair for both is to wait on
        the condition rather than the clock, and to re-measure `REFINE-FAIR`'s tolerance from a
        run population the way `K_MC_TOL_3D` was re-measured from 15 % to 25 % — and doing
        either inside the milestone whose suite it blocked would be indistinguishable from
        loosening a gate to go green, so both are recorded and left. They join `STEP3-ORDER` and
        `STEP3-REGION` as timing fragilities this arc has diagnosed and not owned, and this is
        now four.
      - **Named and NOT fixed.** The CI hole P4 recorded is unchanged and now costs one more
        script: `.github/workflows/ci.yml` fires on push to `main` and on `pull_request`, and
        this arc lives on `v7-experiments`, so the thirteen browser-free gates do not run in CI
        on this branch at all. Separately, `chiPauling` and each row's own `Tm` are still carried
        and read by nothing, and the grid does not change that.
      - **Docs.** `science/index.html` gains a P5 paragraph, gated by the commit that writes it.
        `README.md`'s composer bullet gains the open table — and because that prose quotes the
        mercury advisory's own computed numbers, README joins the doc gate's file list rather
        than sitting beside it, which is the C0b failure mode one layer over. `TESTING.md`
        twelve → **thirteen** in all three places, plus full entries for both new scripts.
        `scripts/capture-demos.mjs` gains the base-switch capture the plan asked for: two stills
        of the same panel, over aluminium and over iron, in their own block because `appShot`
        calls HIDE and the composer is not a child of `#app`.
      - **A REVIEW RAN OVER THE FINISHED MILESTONE: five lenses, 39 agents, and 23 of its
        findings survived a refuter told to default to REFUTED.** Two of them were gates that
        could not fail, and both were mine.
        **(1) `COMPOSER-GRID-PANEL` counted CELLS, NOT PAINTS.** `querySelectorAll(".gcell")`
        counts what `buildGrid` created; `data-tier` is written in exactly one place, inside
        `paintGrid`. So a paint loop that skipped every element past Z 48 — seventy cells,
        including tungsten, mercury, lead and the whole f-block — passed every clause: an
        unpainted cell stores `undefined` on BOTH bases, `undefined !== undefined` is false, so
        it counted as UNCHANGED and actively HELPED the both-polarities clause (14 changed
        dropped to 11, still ≥ 1). Verified by applying the mutation: the gate now reports 48
        painted and fails, where it used to report 118 and pass.
        **(2) `GRID-LAYOUT-TOTAL` could see a collision and not a permutation.** Uniqueness,
        range, the row/block agreement and nineteen spot pins all constrain the SET of occupied
        cells and never which element is in which one. Two mutations passed everything:
        aluminium — this app's flagship base — drawn in group 3 instead of group 13, because
        the cell under scandium is empty so nothing collides; and the whole of period 5 drawn
        right-to-left with rubidium at group 18, because a permutation of a row is still a
        bijection onto 1–18. Fixed by tying every element's COLUMN to the band its own `block`
        implies — a per-element constraint over all 118 rather than nineteen hand-picked ones
        — with helium pinned by name as the layout's single genuine exception. Both mutations
        now fail, and both were re-run to prove it.
      - **And two more holes in the same two gates.** `GRID-REASON-LINE` walked all 708 pairs
        at `probeWt`, which is min(1 wt%, ceiling/2) and therefore STRICTLY below every ceiling
        and always finite — so it never reached PAST-THE-INVARIANT or NOT-A-COMPOSITION, two of
        the eleven reasons and precisely the two whose lines interpolate numbers. A line reading
        "past 0.53 wt% at null °C" would have shipped green. The five per-line assertions are
        lifted into a helper and driven over both branches at the compositions that reach them
        (46 + 12 extra admissions), and the coverage is now itself a gated claim: all eleven
        reasons must be exercised. And the GPU gate clicked ONE refused cell, mercury, which is
        REFUSED-PAIR — so NOT-A-SOLUTE and OUTSIDE-THE-MODEL were never tapped, and one negative
        sample cannot separate `tier === "ASSESSED"` from `tier !== "REFUSED-PAIR"`. Under that
        weaker predicate a click on argon reaches `defaultWt`, whose fall-through dereferences a
        solute row that does not exist, and the panel throws. Three cells now, one per tier.
        Separately the gate never checked that `paintGrid` CLEARS: the base buttons empty the
        mix, `[data-in]` outranks every tier rule in the stylesheet, and a stale highlight would
        have painted an empty iron melt as containing magnesium.
      - **The review also found a UI decision that printed two contradicting claims in one
        panel.** Every noble-gas cell computed a Raoult's-law partial pressure at 1 wt% — argon
        21 atm over aluminium, helium in the FUME band — next to its own refusal saying the
        measured solubility is a part per billion by mole. The helium line read "the addition
        survives the melt" and the argon one offered "unless the melt is held under pressure or
        the element is plunged", which describes plunging argon into aluminium as a technique.
        Raoult's law needs a solution; `vapourAt` now refuses the noble gases by name and says
        why, on exactly the precedent of the mercury-over-iron critical-point cell. In the other
        direction, the panel was showing the advisory ONLY for FUME and BOILS, which silently
        discarded every NO-DATA line in the table — the vapour rule's own refusals, each naming
        the reason it declined. It now prints every band except NEGLIGIBLE.
      - **A call to action had been composed inside the pure classifier.** Every assessed line
        ended "Click to add it to the melt." — and `admit(base, element, wt)` cannot know what
        is already in the crucible, so it went on inviting a click for a solute already in the
        mix, where clicking does nothing. The affordance moved to the panel, which knows, and
        now says one of two true things instead of one sometimes-false one.
      - **A SECOND P4 repair that was written down and never landed.** Beside tellurium, P4's
        review recorded fixing Al–Bi's monotectic sentence, which called 657 °C "a few degrees
        ABOVE pure aluminium's melting point" against the same file's 933.5 K = 660.35 °C. It
        still said above. Two repairs from one review round, both written up as done, neither
        applied — which makes this a process defect rather than an accident, and it is the
        first lesson this milestone wrote down.
      - **Four of my own new comments and two of my own new claims were wrong, and I found the
        comments before the review did.** "93 of the 118 are refusals" mixes two frames (25 pairs
        are pourable across all six bases; over any ONE melt at most six of 118 are, so the
        per-melt figure is 112 and up). "Mercury boils at 39 atm over liquid aluminium" is the
        PURE-element number — at 1 wt% the file's own advisory says 0.053 atm and the band is
        FUME, not BOILS. "The keyboard-reachable path" implied the grid is not, when its cells
        are real buttons. "`probeWt` asks each pair at half its own ceiling" is false wherever
        the ceiling exceeds 2 wt%, which is most of the table — the same over-generalisation of
        a `min()` that the science paragraph made and `GRID-DOC-CLAIMS` caught. And "four times
        past the Al–Ti peritectic" is 3.3 times. The review added two more: the Z > 92 line said
        "reactor-bred and exists in quantity" of berkelium and californium, which are made in
        milligrams and which the paragraph beside it correctly scopes to "the ones just past
        uranium"; and the fume-stripe mechanism was given as "the iron liquidus stands hundreds
        of degrees above their boiling points", where the rule is evaluated at the pure base's
        MELTING point and the true statement is a bracket, not a magnitude — all ten of those
        boiling points fall between aluminium's 660 °C and iron's 1538 °C, by as little as
        11 K at one end and 54 K at the other. Both now gated, the bracket recomputed from
        `MATERIALS` and the two margins held as named numbers.

- [x] **P6 — the tour chapter, the honesty page's remaining debts, and the retraction the front door still owes.**
      Two debts come due. The front door contradicts the honesty page with numbers that page says were withdrawn twice, on the app's most visually dramatic moment. And four numbers quoted as prose — 0.821 and 0.993 (`science/index.html:131-132`), Q ≈ 71 K and Q ≈ 1 K (`index.html:470,473,477`) — are literal `derive()` outputs with **no gate on them**, which is exactly the failure mode C0b was built to close, one layer over.
      - **The tour chapter does not drive the composer DOM.** `#composer` is `position:fixed; inset:0; z-index:30` with a backdrop whose `pointerdown` closes it (`composer.ts:74`); `#tour` has no z-index and sits at `left:18px; bottom:62px` (`app/index.html:161`), so while the composer is open the tour's "next ▸" is underneath the backdrop and clicking it dismisses the composer; and `TourHost` (`tour.ts:194-202`) has no composer handle — `openComposer` lives on `UIHost`. Restructuring the composer from a modal to a dockable panel is real work and is **not** in this arc. The chapter is prose that opens the composer and points at what to move, the way `tour.ts:273` already points at it, and the claim it makes is gated on the pure layer instead.
      - **`index.html` ACT 3 is rewritten.** It currently animates a count to 369 against 46 and captions it "Composition alone refined the metal eight-fold … Measured in this instrument, not asserted." `science/index.html:124-144` says that comparison was withdrawn in v4.0, that its inversion was **also** an artefact, and that the controlled answer is the two alloys come out the same within noise (1434/1380, 1431/1445, 305/313, 351/327). The two Q values are genuinely computed and stay; the grain-count claim goes. The replacement drama is the marker crossing a line on a figure while the casting changes beside it — less exciting, and true. `src/tour.ts:273` carries the same retracted claim ("the growth restriction factor Q it reports genuinely refines the grains here") and is fixed in the same commit.
      - **Gates.** `PD-DOC-CONSTANTS` (doc) — HT-DOC-CONSTANTS' mechanics verbatim, one layer over, at the bottom of `scripts/verify-phasedata.mjs` so CI runs it. Expected values are DERIVED FROM MODULE EXPORTS, never literals: `PHASE_TABLE_VERSION`, the Al–Si and Fe–C invariants read out of `phasedata.ts`, ΔT₀(A356) recomputed through `calibrate()`, and the four existing `derive()` outputs. All documents must literally contain them. The `doc()` file list grows from three to **four** — `science/index.html`, `TESTING.md`, `README.md` and now `src/tour.ts`, or the front door gets fixed while the tour keeps saying it. A `stale[]` array bans "refined the metal eight-fold", the 369-grain caption, "six base metals", "each base's curated solutes", and any surviving per-solute `cap`-as-physics phrasing. Every ban regex carries a negative lookahead so the sentence *describing* the ban does not trip it — this repo has failed that exact self-reference twice, at C0b and again at C2, on the introducing commit both times — and every ban is run against both the pre-fix and post-fix trees before the milestone is trusted, exactly as POR-PORE-SOLUTE was. `CI-SCRIPT-COUNT` (doc) — `TESTING.md`'s stated count of browser-free scripts equals the number of `- run: node scripts/verify-*.mjs` lines in `.github/workflows/ci.yml`, at all three places the count is written (lines 25, 41, 469 today, against exactly seven run lines). Nothing checks this and this arc adds one script. Liveness: the derived count is > 0 and all three doc sites are asserted FOUND, so a renamed heading cannot make it vacuous. `PD-CHAPTER-PURE` (browser-free) — the claim the tour makes, gated where it can be gated: crossing Csm on the Si slider flips `notGrown` from absent to present containing the row's own eutectic token, changes the regime, and changes the shaded band's vertices. Both polarities; a presence-only check would pass on a line that was always there. `TOUR-PD-STEP` (GPU) — the chapter opens the composer, advances past its first step, and the composer is asserted visible; nothing cross-drives the two panels.
      - **Docs.** `README.md`: the base list, "ten qualitative identities" (MATERIALS has eleven), and the per-element/per-pair coefficient phrasing. `TESTING.md`: the new script, every new gate, and the three counts. `science/index.html`: the honesty sentence and the provenance note pointing at `docs/PHASE-AUDIT.md`.

      - **DONE 2026-08-17.** Both debts are paid and the arc's last gate is a doc gate. The front
        door no longer animates a count to 369 grains against 46 under the caption "Composition
        alone refined the metal eight-fold — measured in this instrument, not asserted", which
        the honesty page two clicks away had recorded as withdrawn in v4.0 and whose inversion it
        had recorded as an artefact too. In its place is the claim this whole arc earned: an
        **Al–Si diagram drawn from the cited invariants, with the composition marker walking from
        0 to 7 wt% Si and crossing the 1.65 wt% line while the phase readout beside it turns from
        "(Al) — everything dissolves" into "(Al) + (Si)"**. Both Q values stay, because both are
        genuinely computed; the two bars now measure **liquidus depression, 44.7 K against
        1.6 K**, which is the mechanism the honesty page names as the reason the uncontrolled
        comparison looked like a result. And the tour gains chapter **11 of 32, "The line you can
        cross"** — the first chapter that opens the composer.
      - **The four numbers the milestone was written for are gated, and so are thirteen more.**
        `PD-DOC-CONSTANTS` recomputes 0.821, 0.993, Q 71 K and Q 1 K from `derive()` and requires
        the documents to contain them. Everything else it checks is derived the same way: the
        table version, Al–Si's 1.65 / 12.6 / 577, Fe–C's 0.53, A356's 303 K, the two depressions,
        `MATERIALS`' eleven identities, `SCENES`' nine presets and both k-ratio spans.
      - **FIVE gates, not the plan's four, and SIX documents, not four.** `index.html` is the
        fifth document because that is where the retracted claim actually lived and where both Q
        values are printed — a list without it could gate neither, which makes the plan's
        four-file list one the ban could never have fired in. `src/alloy.ts` is the sixth, added
        when the audit found the Scheil floor's justification quoting a k-ratio span of
        "0.68 to 3.30" that **no set in the tree produces**: 3.30 is cu-Sn, a peritectic the very
        gate it credits excludes, and 0.68 is the minimum of the fifteen rows that gate enters.
        Measured, it is 0.39–3.30 over all 23 rows with an invariant and 0.68–2.34 over the
        fifteen `PD-CONSTRUCT-AGREE` actually reaches. Both are now recomputed.
      - **The bans self-test instead of carrying negative lookaheads, and that is a deliberate
        departure from the plan.** The plan called for a negative lookahead per ban so the
        sentence describing a ban would not trip it. Eight hand-written lookaheads are eight
        chances to repeat the exact mistake this repo has already made twice, at C0b and C2. So
        the scanner strips, ONCE, what is quotation rather than claim — backticked spans in
        markdown, HTML comments, TS comments — and every ban carries a fixture that MUST fire and
        a real sentence from this tree that must NOT, both pushed through that same scanner.
        A stripper that neutered a pattern fails on its own fixture, not in six months. It caught
        one immediately: the honesty page's new paragraph quoted the retracted caption verbatim,
        so the page now paraphrases it and keeps only the damning half in quotation marks.
      - **The tour chapter opens the composer, and the z-index is the whole finding.** `#composer`
        is `position: fixed; inset: 0; z-index: 30` with a backdrop whose `pointerdown` closes it;
        `#tour` had no z-index at all, so a chapter that opened the composer buried its own
        "next ▸" under that backdrop and the only way out of the chapter was to dismiss the thing
        it had just opened. `#tour` is now `z-index: 31` — `#app` is `position: absolute` with
        `z-index: auto` and no transform, so it creates no stacking context and the two values
        compare directly. `TOUR-PD-STEP` asserts **`document.elementFromPoint` at the button's own
        centre**, not visibility: the panel was "visible" throughout the defect. On the pre-P6
        tree that read `composer`; it now reads `self`. Leaving the chapter closes the modal, in
        the same two places and for the same reason `clearReveals` fires, and coming back reopens
        it: the measured sequence is `[true, false, true, false]`.
      - **The plan's mechanism claim for `PD-CHAPTER-PURE` was wrong and measuring it said so.**
        "Crossing C_SM flips `notGrown` from absent to present" is **false for Al–Si**: at
        1.60 wt% Si the line is already there, because Gulliver–Scheil puts 9.3 % of a lean charge
        through the eutectic even where equilibrium leaves it single-phase. What flips at 1.65 is
        the KIND of line — a Scheil-only caveat below, an equilibrium second phase above — and
        that is the stronger claim, because a presence check passes on a line that was always
        there. **Fe–C is where absent-to-present is real** (nothing at 0.09 wt% C, one line at
        0.10), so the gate drives both pairs and asserts both shapes rather than assuming one of
        the other. Bands: al-Si [0, 1.65] → [1.65, 12.6]; fe-C [0, 0.09] → [0.09, 0.53].
      - **A 53-agent audit of all five user-facing documents returned 34 findings that survived
        adversarial refutation, and every one of them is fixed in this commit.** They were not
        small. The front door's `<meta description>` — the sentence that goes into search results
        — claimed "the logo is cast by the solver"; `src/logotype.ts` no longer exists,
        `resetMold` has zero call sites, and `#heroAct` has never contained a canvas. A stamp on
        the same page listed **twinning** among "emergent" physics beside CET and recalescence,
        where the honesty page says plainly that twins spawn at a rate the user sets and only
        their survival emerges. The honesty page itself claimed the controlled comparison agrees
        "to better than 8 %" — the gate asserts **15 %**, and this ledger's own P5 entry records
        the same comparison measuring 9.9 %, 11.6 % and once 15.2 %, a gate failure. It anchored
        E112 and SDAS to "a nominal 1 mm domain" nine rows above the row retiring exactly that.
        It priced the volume at "seven textures" where `build()` creates nine, and put the 3D
        Euler step at 0.53·dx²/6 where the shipped ratio is 0.60 — 0.53 is the 2D margin against
        dx²/4. The tour said the optimizer's genome was four genes (it is five; the initial
        undercooling is the one the recipe card prints first), that MODES holds two modes (four,
        and in TRUE 3D it holds exactly the two that sentence omitted), that a cubic metal grows
        along four directions (six; the 2D section holds four, as chapter 28 already said), that
        the symmetry control is a two-way toggle (six buttons, and chapter four tells you to press
        one this sentence denies exists), that the furnace takes three dials (five since C2), that
        TRUE 3D gives seven million voxels flat (the top rung of a ladder to 96³, and this body is
        spliced verbatim into the message shown to devices that cannot run the volume at all),
        and that the selector races sixty grains (`chillFloor` plants 8 × 8 = 64; the only 60 in
        the file belongs to the weld preset twelve lines above). README priced the source at
        "~2.5k lines" against 22,987, claimed "verified headlessly (64 grains → 1)" where the only
        selector gate asserts `scen === 3` and hardcodes its own solid fraction to 0, called the
        quick solute list six when zinc's is one, and presented the composition ceiling as coming
        from the diagram "rather than" a hand-picked bound when the diagram is the smaller term
        for **5 of 25 pairs**.
      - **`TESTING-CHECK-COUNT` is the fifth gate and it exists because of what that audit found
        in TESTING.md.** Eight stated counts were wrong at once: `verify-units.mjs` said eight and
        has nine, `verify-quant.mjs` ten against eleven, `verify-3d.mjs` was cited as a 23-check
        suite and prints 29, `EL-DOC-CLAIMS` sixteen claims against seventeen,
        `ALLOY-REFUSE-NAMED` eight input shapes against fifteen driven, the element reasons 31
        skeletons against 32, five peritectic exclusions stated as the table's whole peritectic
        population of seven, and `ALLOY-PHASES-NAMED`'s polarity given as four-and-five where it
        measures seven-and-two. Two more were not counts but retracted claims: the residual offset
        described as "present for every multi-solute preset and absent for every single-solute
        one", which is the exact claim that gate's own comment says it retired after tin bronze
        floated 30.8 K with one solute; and a `--use-angle=swiftshader` fallback "the scripts
        themselves fall back to", where two dive scripts pass the flag unconditionally and **no
        script detects a GPU or retries**. Hand-correcting eight numbers with nothing under them
        is how there came to be eight, so wherever this document states a check count in words the
        gate now counts the distinct gate NAMES in the script that bullet's own header names. Ten
        sites, liveness floor six. Distinct names rather than call sites, because
        `PD-FIGURE-CURSOR` reports from two branches and a call-site count would make the document
        wrong for being right; attribution by bullet header rather than proximity, because
        `verify-scale3d.mjs`'s entry contains "the full 29-check volume suite" about a different
        script entirely.
      - **Every gate was run against a mutation before it was trusted.** The z-index removed →
        `"next ▸" is buried under composer`. `closeComposer` deleted from `goto` → `leaving the
        chapter left the composer open over the next melt`. `PD-CHAPTER-PURE`'s lean probe moved
        to the rich side of C_SM → five clauses fire. The old caption restored in `index.html` →
        the eight-fold ban fires. README's "eleven" reverted to "ten" → one missing claim and one
        stale claim. A fourteenth run line added to `ci.yml` → all three TESTING sites disagree.
        `verify-rng.mjs`'s stated count changed to six → `TESTING-CHECK-COUNT` names it.
      - **One defect of my own, caught by the same audit.** The new chapter's first draft read
        "the app names the phase it will not grow — the silicon of the 577 °C eutectic, about half
        the casting by the lever rule". The lever rule gives the share of liquid left at the
        invariant, which freezes as the eutectic CONSTITUENT — (Al) and (Si) together, 48.9 % —
        so that sentence counts the eutectic's own aluminium as silicon. The chapter now names the
        constituent and `PD-CHAPTER-PURE` requires it to.
      - **Not done, and named.** CI still runs on push-to-`main` and `pull_request` only, so none
        of the thirteen browser-free gates fire on `v7-experiments` — unchanged from P4 and P5,
        and now costing three more gates. `REFINE-FAIR` and `ATMOSPHERE` remain load-fragile at
        script 17 of 26 and were not loosened. The grain selector's "64 → 1" is now described
        honestly rather than measured; earning that sentence needs a gate that stages
        `SCENES3.selector`, grows it, and counts what leaves the pigtail.

      - **One deliberate consequence of the z-index, recorded rather than discovered later.**
        `#tour` at 31 now paints above `#foundryResults` (7), `#slicePop` (6) and `#overlay` (6)
        as well as above the composer, where before it painted below all of them. The lab report
        card is the only real overlap — 400 px on the left against the tour's 330 px at the
        bottom-left — and the trade is the right way round: the tour's own controls were
        previously unreachable behind the report card of the casting its lab chapter had just
        told the reader to pour. `#gate` stays at 50, so the WebGPU refusal still covers
        everything.
      - **Verification, stated as it actually ran.** `npx tsc --noEmit` clean; `npm run build`
        clean, and the landing chunk still contains **zero** chemistry bytes — no
        `PHASE_TABLE_VERSION`, `BINARY`, `eutectic`, `Gulliver`, `probeWt` or `admit` — which is
        what the hand-written SVG and the geometry-read-from-markup in `landing-motion.ts` are
        for. All thirteen browser-free scripts pass individually. `npm test` ran **18 scripts and
        112 checks with one failure**, and the failure is `REFINE-FAIR`, which is not this
        milestone's: it read 353 against 299 grains on its 600-site arm, an 18.1 % deviation
        against a 15 % band. The remaining eight scripts were then run directly against the same
        tree — `passsplit`, `quant`, `phasediagram-gpu`, `composer-gpu`, `experiment-gpu`,
        `heattreat-gpu`, `scale3d`, `3d` — and every one reported `done` with **PAGE ERRORS:
        none**, including `TOUR-PD-STEP`. So the suite is clean apart from that one arm, but it
        was not clean in a single invocation.
      - **And measuring that arm three more times turned a flake into a finding.** In isolation
        `REFINE-FAIR` passed 3/3 (600-site pairs 350/313, 363/337, 356/340). Pooling everything
        recorded: **at 3000 sites the two charges agree to within 1 %** across four pairs, and
        **at 600 sites seven pairs span 4.7 % to 18.1 % with the refined charge finer in six of
        the seven**. The diagnostic is in the same output: for the same 600-site charge the lean
        melt fired **349** sites in one run and **all 600** in another, which is exactly the
        frame-pacing artefact the science page already records as a non-controlled variable. So
        the low-site arm is not settled, the honesty page now says so with the numbers, and the
        tolerance was NOT loosened — a gate relaxed to go green inside the milestone it blocks is
        indistinguishable from a wrong gate.

---

### What this arc deliberately does not do

- **It does not make the solver multicomponent or multiphase.** One solute field, one solid phase, five scalars at uniform slots 24–28. Growing a second φ field is the only thing that would turn the phase readout into a simulation rather than a drawing, and it is out of scope twice over: it rewrites the uniform layout and the kernels, and it would then have to land **after** Q3 or PASSSPLIT3's bit-exact refactor gate loses its teeth. Named here as the tripwire that moves this arc's slot if it ever enters it.
- **It does not vendor TDBs or run pycalphad in the build.** Genuinely better physics — real curved liquidus, m(c)/k(c), Scheil integrated rather than closed-form — and rejected on gate shape, which is how this repo decides. CI runs `npm ci` then node; a pinned Python 3.11+ with a compiled symbolic backend cannot run there, so every number would be frozen into an asset nothing in CI re-derives — the exact drift class `gen-grain.mjs`, `gen-dive-art.mjs` and the ungated hand-port at `dive3d.ts:377` already exhibit. The internal two-table cross-check runs on every commit and is therefore the stronger gate. It also drags ODbL §4.4a share-alike onto the shipped bundle. `docs/PHASE-AUDIT.md` is the offline audit route instead: full reproducibility, zero obligation.
- **It does not ship an ESTIMATED tier, and Darken–Gurry is not in the code at all.** Measured over the app's own 25 pairs the Darken–Gurry ellipse refuses 10 — Al–Cu, Al–Mg, Fe–C, Ni–Nb, Ni–Ti, Ni–Al, Ni–W, Mg–Al, Mg–Zn, Cu–Sn — and every one of the 9 presets contains at least one pair it rejects. A category error, not a bad threshold: it predicts *extensive* (>5 at%) solubility while every casting solute here is dilute and limited by construction. It scores 4/7 in the cap role too. It appears exactly once, in this postmortem, as the measured reason it is not in the code. An estimated coefficient can be promoted to an assessed one by a code change, and no structural guard survives contact with a hurry.
- **It does not use van 't Hoff as an estimator.** Over 14 shipped systems the ratio spans 0.04–1.69, and structurally it constrains only the product m(1−k) — one equation, two unknowns — so it can never deliver `mLiq` and `kPart` separately. Kept only as a k ≤ 0.2 transcription tripwire.
- **It does not fetch anything at runtime, and it does not use 0 K convex hulls or Wikimedia diagram images.** MP/OQMD hulls are 0 K, 0 atm, solids-only with no liquid phase and no temperature axis by MP's own documentation — structurally incapable of showing a liquidus, a solidus, a freezing range or a eutectic temperature, and they would render line compounds as "the phases present" above every solvus. Commons diagrams are frequently "own work" redraws of ASM/Pauling File originals and, decisively, you cannot ask a PNG which phases exist at 640 °C and 7 wt% Si without a digitisation step that would instantly be the least defensible number in the codebase.
- **It does not redistribute anything proprietary.** ASM APD, ACerS-NIST PED SRD 31 (its agreement forbids derivative works explicitly), SpringerMaterials/Landolt-Börnstein, Thermo-Calc, FactSage, Pandat, and AFLOW (non-commercial clause) are all out. COST507 is out as a shipping source: no Fe–C, Fe–Ni or Fe–Cr liquid assessment and no explicit licence anywhere — "available for free" is not a grant. 25 cited invariant rows for systems the app already ships is a citation, not a copy.
- **It does not open the base set.** A base with no `MaterialSI` has no `Tm`/`L`/`cp` (no thermometer, `units.ts:220`), no `Dl`/`alphaTh` (no clock), no Γ or ε₄ so no calibrated mode at all (`main.ts:204-206` returns null), and no grain-growth, oxidation, Hall–Petch or hydrogen data. P1 fixes the guard that today lets `applyAlloy` print a composed name over a `setMaterial` that silently refused; the set still stays at six until a new base ships a full `si` block with a source sentence.
- **It does not admit H, N or O as composer solutes**, and it does not restructure the composer from a modal into a dockable panel — that is real work with its own budget and it is what a DOM-driving tour chapter would require.
- **It does not sample m at the poured composition from a baked m(c) array.** More accurate — the Cu–Sn liquidus is strongly curved toward its peritectic and `materials.ts:127` already says so — but it needs the rejected generator, and it would move `mLiq` for every non-dilute preset, both REFINE-FAIR arms and two doc-quoted numbers. The straight chord is what the solver integrates; drawing and using the same chord keeps the figure a picture of the model, and the curvature is printed as the caveat.
- **It does not land as one commit.** Seven independently gated milestones, on the C0b/C0c precedent, so a suite failure has one candidate cause rather than five.

### Open questions for Frank

1. **Cast iron leaves the composer at P3.** Fe–C is refused above 0.53 wt% C because past the δ-ferrite peritectic the primary phase is austenite and this solver has one solid phase, which is δ-ferrite. 1045 and 4340 survive at 0.45 and 0.40. This is an intended break of a shipped slider range and it is the only user-visible capability this arc removes — confirm you want it removed rather than left reachable with a loud warning.
2. **Al–Cu k is double-valued and P0 picks one.** `alloy.ts` ships 0.15 for the Cu-in-Al solute; `materials.ts:61` ships `si.kPart = 0.17` for the same system with an Al–4Cu source sentence. (`params.kPart = 0.14` is the dimensionless knob and stays.) Which one is the app's, or do you want the pair row and the SI block to keep diverging with the reason written into both source strings?
3. **`docs/PHASE-AUDIT.md` claims per-row offline reproducibility through MatCalc/NIST TDBs + pycalphad.** Do you want that reproduction actually *run* for all 25 rows before P0 ships (a real afternoon, and Mg–Zr, Ni–W and Al–Ti may have no open assessment at all, in which case those rows carry a "no open reproduction path" flag), or shipped with the flag honest and the runs done incrementally?
