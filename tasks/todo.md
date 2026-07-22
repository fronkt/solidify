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
