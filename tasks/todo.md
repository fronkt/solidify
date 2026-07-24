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

**The organising idea.** Heat treatment runs on a clock ~10 orders of magnitude longer than
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
- [ ] **H3** — annealing twins (Σ3 on migrating boundaries, 3D, low-SFE cubic only)
- [ ] **H4** — homogenization (solute diffusion at frozen φ)
- [ ] **H5** — oxidation and decarburization
- [ ] **H6** — Hall–Petch and the report-card verdict
- [ ] **H7** — the panel, the `reheat` rename, science §9, README, TESTING, tour

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
- [ ] **L3** — refiner fade: `n_max` decays with the hold above the liquidus (settling +
      agglomeration + oxide, faster than Stokes alone; grain size falls to a minimum then
      rises), deleting the science row "n_max does not fall when you overheat the charge".
      `nucleation.ts` + a "hold before pour" lab field + a browser-free gate; fade at zero hold
      is byte-identically today's behaviour.
- [ ] **L2** — hydrogen porosity via Sievert's law: `C = K√p_H2` with real solubility data
      replaces `lab.ts`'s admitted `+0.1` porosity hack; feeds the existing `pPore` param (no
      shader change). Materials without H data refuse honestly.
- [ ] **L4** — Hall–Petch yield + spec pass/fail verdict — **deferred until H6 lands**, reusing
      its verdict logic rather than minting a second one.
