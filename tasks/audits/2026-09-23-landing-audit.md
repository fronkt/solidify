# Landing audit: removing the scroll-pinned dive

Repo: `C:\Users\frank\solidify`, branch `v7-experiments` @ `6ec93a1`. Working tree clean apart from the untracked `.claude/` and `dist-embed/` (neither mentions the dive). Nothing in the repo was edited. All builds and gate runs below used a scratch copy at `scratchpad/after/`, with `node_modules` linked back to the repo through a junction.

## 0. What the dive is today

- **3D path.** `src/dive3d.ts` (1,956 lines) draws 13 Three.js wireframe stages. Each HUD entry is a `META` row at `src/dive3d.ts:108-122`, and `WEIGHTS` is at `:125`. `initDive3D()` runs from `:151` to `:374`. Its `ScrollTrigger` has `id:"dive"`, a pin length of `end:"+=19000"`, `scrub:1` and `refreshPriority:1` (`:352-363`). The stage builders begin at `:376`. The specimen puck uses d3-delaunay (`:1738+`), and the dendrite comes from `genDendrite()` (`:1890`).
- **Fallback path.** `src/dive.ts` (117 lines) is the 2.5D SVG camera over the five `.stage` SVGs. It creates its own `ScrollTrigger` with `id:"dive"` and `end:"+=5200"` (`:102-113`). It runs when WebGL fails and in reduced-motion mode, where it renders a static stage.
- **Boot order.** `src/landing.ts:98-106` awaits `import("./dive3d")` BEFORE WebGPU boot, so every sim act waits for a 574 kB chunk to download and for WebGL to initialise.

## 1. Everything that must be deleted or rewired

### src/landing.ts
| line | what | action |
|---|---|---|
| 11 | `import { initDive } from "./dive";` | delete |
| 56-85 | the `initGrainCurtain()` grain "wave" comment and function, keyed to `ScrollTrigger.getById("dive")`, trigger `#diveAct`, `start/end: () => dive.start/end`, `scrub: 1` | delete whole block |
| 92-97 | the pin-order comment ("AWAITED on purpose … AFTER the dive's pin exists … 8200px pin spacer … GPU → lens act → die") | delete |
| 98-106 | `if (reduced) initDive(true); else { await import("./dive3d") … initDive(false) }` | delete |
| 107 | `if (!reduced) initGrainCurtain();` | delete |
| 1-6 | header comment ("Two real simulations share one GPU device") | already stale: three sims (lens, mat, d3). Optional touch-up; not about the dive |

Line 108 (`if (reduced \|\| !navigator.gpu) return staticFallback();`) stays. `gsap` and `ScrollTrigger` are still used by the lens and material pins. With the dive gone, no pin comes before lens/mat, so the ordering hazard goes with it. `history.scrollRestoration` (`:89`) is still justified by the two remaining pins. In the scratch copy, `tsc` (noUnusedLocals) is clean after these deletions.

### src/landing-motion.ts
**No dive coupling at all.** The only selectors are `#heroAct`, `.stats`, `#composeAct`, `#sciAct`, `.cta` and `#topnav`. Nothing to change for the dive. For the `.after` cut, see §5.

### index.html
| line(s) | what | action |
|---|---|---|
| 43-51 | `#grain` comment describing the `--gline` wave, the dive, ALL IN ONE, and "same network as the specimen puck" | rewrite to a static-backdrop comment |
| 53 (`--gline: 140%`), 54-55 (`-webkit-mask-image` / `mask-image` gradient on `--gline`) | the wave mask | once no wave exists, `--gline` stays at 140%. The mask is then opaque from 102% down, which means it does nothing, so delete it (a full-viewport fixed mask adds compositing cost) |
| 57 | comment "(the #diveAct re-opaque lives after its rule below)" | delete the parenthetical |
| 117-177 | all dive CSS: `#diveAct`, its reduced-motion rule, `#diveStage`, `.stage*` (incl. `.nogpu .stage`), `#dive3d`, `#diveLabels`, `.live3d`, `.dlab*`, `#diveReticle*`, `#diveCta*`, `#diveHudTL/BL/BR`, `#diveTitle`, `#diveSub`, `#diveField`, `#diveDashes*` | delete (4.8 kB) |
| 316-429 | the whole `<section id="diveAct">`: `canvas#dive3d` (319), S1 GPU card SVG (321-334), S2 package (336-348), S3 microscope (350-382), S4 specimen (384-409), S5 dendrite (411-420), `#diveLabels` (422), `#diveReticle` (423), HUD TL/BL/BR incl. `#diveCta` "ENTER THE LAB →" (425-428) | delete (36.9 kB) |

Keep these: `.simBox`, `.nogpu .simBox`, `.k`, and `#threeDAct.no3d` (other acts use them).

### Files that exist only for the dive
- `src/dive.ts` (117), `src/dive3d.ts` (1,956)
- `src/dendrite.mjs` (110) and `src/dendrite.d.mts` (7). Their only consumers are `dive3d.ts:20` and `scripts/gen-dive-art.mjs:155`.
- `scripts/gen-dive-art.mjs` (165) and its pasted output `scripts/dive-art-out.txt` (28.8 kB)
- `docs/dive-art-spec.md` (45 lines, cited from `dive.ts:8`). Frank's archive rule applies: archive it rather than silently deleting.
- `docs/dive-column.jpg` (77 kB, cited from `README.md:21`)
- `scripts/verify-dive.mjs` (66) and `scripts/verify-dive-fallbacks.mjs` (39)

All of these are tracked in git.

### Comments that go stale but still work
- `scripts/gen-grain.mjs:2-3`: "the same d3-delaunay Voronoi the specimen puck uses in dive3d.ts".
- `scripts/capture-demos.mjs:147-164`: the "dive-column" screenshot block. It scrolls `#diveAct`'s pin-spacer to 0.39×19000. **Delete it.** If it stays, `document.getElementById("diveAct")` is null, `act.closest` throws, and the script dies after the other stills are written.

### package.json
- `three` and `@types/three` become entirely unused. **three is imported only at `src/dive3d.ts:12-16`**, and neither the app nor the TRUE 3D act uses it. Run `npm uninstall three @types/three`.
- `@types/d3-delaunay` becomes unused, since the only TS importer is dive3d.
- `d3-delaunay` is still used by `scripts/gen-grain.mjs:7`, a dev-time generator. Keep it, or move it to devDependencies, because no runtime import remains.

## 2. Test-suite coupling

| file:line | gate / script | effect of removing the dive |
|---|---|---|
| **`scripts/verify-composer-grid.mjs:604` and `:607`** | **`LANDING-CLOSURE-CLEAN`** liveness list `["sim","render","shaders","materials","dive","rng"]` with `landingHas.length === 6` | **FAILS. Verified on the scratch copy:** `landingClosureSanity: [sim,render,shaders,materials,rng]` gives `1 FAILED`, exit 1. **This script runs in CI** (`.github/workflows/ci.yml`), so it breaks the build. Fix: drop `"dive"` and compare against the list's own length (or 5) |
| `scripts/run-tests.mjs:32-33` | SUITE entries `verify-dive.mjs`, `verify-dive-fallbacks.mjs` | must be removed. `run()` rejects on a missing file, and that rejection aborts the loop, so **every later GPU gate would be skipped** (optimizer, tools, passsplit, quant, heattreat-gpu, scale3d, 3d …) |
| `scripts/verify-dive.mjs` (whole) | 3D-engaged check (`live3d`, `#dive3d` width, `.dlab` count), 10 scroll shots at `p*19000`, fan-a/b, FPS probe | delete. It is screenshot-only and never sets a failing exit code, so no assertion is lost |
| `scripts/verify-dive-fallbacks.mjs` (whole) | no-WebGL → `.stage` shown, reduced-motion static stage, 390×844 phone | delete. Also screenshot-only, with no failing exit code |
| `scripts/verify-scroll-order.mjs:1-6, 23, 39-47` | pin-overlap walk; the header and boot comment describe the dive, and `:40-47` shoots `order-dive-tail/after-dive/mat` off `pins.find(id==="dive")` plus `report.pins[2]` | keep the script, because lens → mat ordering still matters. Rewrite the comments and the shot block. Without the dive, `dive` is undefined, so the block is silently skipped. Pre-existing weakness: the script only `exit(1)`s when WebGPU is absent and just prints `OVERLAPS!` otherwise, so it is not a real gate |
| `scripts/verify-phasedata.mjs` `PD-DOC-CONSTANTS` (`:272`, claims `:322-356`), `PD-LANDING-FIGURE` (`:455+`) | read `index.html` | **pass after dive removal. Verified on the scratch copy:** "all phasedata checks passed". Every index.html claim lives in `#composeAct`/`#pdFig` |
| `scripts/verify-phasedata.mjs` `TESTING-CHECK-COUNT` (`:614+`) | would flag a TESTING bullet naming a missing script | the dive bullets state no "N checks", so a stale bullet would **not** be caught. Remove it by hand |
| `CI-SCRIPT-COUNT` | counts browser-free scripts | unaffected, because the dive scripts are browser/GPU ones |
| `scripts/verify-regimes.mjs:644-646`, `scripts/verify-composer-grid.mjs:192-193` | label "index.html:485" for the landing's `#alloy=` link | label only, not asserted. Already stale: the link is at `:562` now and will be about `:387` after removal |

## 3. Docs that describe the dive

- `README.md:17-21`: "The landing page opens with a scroll-driven descent … every scene a live 3D wireframe", followed by `![…landing dive](docs/dive-column.jpg)`. Rewrite or remove.
- `TESTING.md:41-45`: "Two of them, `verify-dive.mjs` and `verify-dive-fallbacks.mjs`, launch Chrome with `--use-angle=swiftshader` unconditionally". After removal, no verify script uses swiftshader, so rewrite this.
- `TESTING.md:470-472` (verify-dive bullet) and `:473-475` (verify-dive-fallbacks bullet): delete.
- `TESTING.md:476-479`: the verify-scroll-order bullet says "dive → lens → materials" and "without the dive's spacer". Reword to lens → materials.
- `CONTRIBUTING.md:15`: "landing-page motion, the scroll dive". Drop "the scroll dive". Lines 19-21 ("pinned-scroll-trigger ordering") are still valid.
- `docs/dive-art-spec.md`: the whole file (archive it).
- **No dive mentions:** `science/index.html` (its only landing reference, `:163-168`, is the retracted 369-vs-46 grain claim), `paper/paper.md`, `contact/`, `app/`, `docs/PHASE-AUDIT.md`, and the landing archives in `docs/` (the "dive" hit in `landing-review-notes.md:17` is the word "diversity").
- `tasks/todo.md:251-310`: the historical v1.1/v1.2 dive build log. Leave it as history and add a removal entry.

## 4. Bundle impact (measured, not estimated)

`npx vite build --outDir scratchpad/build-before` came from the repo. `build-after` came from the scratch copy with the §1 index.html and landing.ts edits applied and dive.ts/dive3d.ts removed. The repo's `git status` was unchanged after both builds.

| asset | before | after |
|---|---|---|
| `index.html` | 70.20 kB (23.38 gz) | **28.33 kB (9.16 gz)** |
| `landing-*.js` | 171.71 kB (67.65 gz) | 168.47 kB (66.19 gz) |
| `dive3d-*.js` (lazy, but awaited on every non-reduced-motion visit before the sims boot) | **573.73 kB (151.68 gz)** | **gone** |
| render / sim3d / shaders3d / render3d | unchanged | unchanged |

- **Chunk composition.** The dive3d chunk is about 512 kB three.js (the 12 imported classes, 132 kB gz by esbuild), about 19 kB d3-delaunay (7 kB gz), and about 42 kB of dive3d plus dendrite code. It imports gsap from the landing chunk.
- **Does three leave the landing? Yes, and it leaves the whole project.** The TRUE 3D act (`#threeDAct` / `d3Sim`) is WebGPU `Sim3D`/`Renderer3D` (`landing.ts:206-239`, loop `:266-287`) and uses no three.js.
- **Critical path.** The landing's HTML plus JS goes from about 270 kB gzip to about 103 kB (−62%). It also drops one WebGL context, the eager build of 13 stage geometries (including a Voronoi), and the >500 kB chunk warning. The sims no longer wait on the dive.
- **Lines of code.** About 2,190 lines of src (dive.ts, dive3d.ts, dendrite.mjs, .d.mts), about 48 lines of landing.ts, about 175 lines and 42 kB of index.html, and about 270 lines of scripts plus 29 kB of pasted art. Removing the 19,000 px pin plus its 100dvh section makes the page about 19.9k px shorter.

## 5. Landing acts after removal

| act | markup | live canvas / motion |
|---|---|---|
| Hero `#heroAct` | index.html:295-314 | **No canvas** (comment at `:74-79`). CSS-text wordmark with anime.js letter stagger (`landing-motion.ts:56-88`), tagline, 4 CTAs, 5 count-up stats |
| Lens `#lensAct` | :432-445 | WebGPU `Simulation` 256² plus `Renderer` on `#lensSim`, pinned `+=3600` (`landing.ts:162-169`). Scroll cycles the 10 lenses, 9-seed alloy pour, re-pours at fracSolid > 0.93. Fallback `snowflake.jpg` |
| Materials `#matAct` | :448-462 | Second WebGPU `Simulation` 256² on `#matSim`, pinned `+=2200` (`:197-204`). Steel/Al/Zn/ice. Fallback `hero.jpg` |
| TRUE 3D `#threeDAct` | :465-482 | WebGPU `Sim3D` 96³ plus `Renderer3D` raymarch on `#d3Sim`, not pinned, IO-gated. Grows once and freezes at fracSolid > 0.45, slow orbit of about 52 s. Fallback `dendrite3d.jpg` via `.no3d` |
| Compose `#composeAct` | :485-566 | DOM only: alloy chips, Q count-up (`data-q=71`), hand-drawn Al–Si `#pdFig` with a walking marker (`landing-motion.ts:110-148`), ΔT_L bars, CTAs |
| Science `#sciAct` | :569-584 | DOM only: typed equation, citations, 3 stamps, CTAs |

**The `.after` wall of text** is at `index.html:549-560`: about 179 words and 1.16 kB, retelling the withdrawn grain-count comparison.
- **Safe to cut as far as the gates go.** Verified on the scratch copy: `verify-phasedata` and `PD-DOC-CONSTANTS` still pass with it removed, because no claim lives in it.
- **Dead code left behind by the cut.** CSS `:242-243`, the pre-state `.anim #composeAct .after` at `:268`, and the selector at `landing-motion.ts:170`. The selector is harmless but consumes a stagger slot, so the CTA would appear about 140 ms earlier once it is removed.
- **Honesty judgement call.** It is the front door's only pointer to the retraction recorded at `science/index.html:163-168`. A one-line replacement ("Neither number is a grain count; why, on the science page") keeps that link.

## 6. A hero video: can the pipeline serve one, and can the app record it?

- **What exists now.** `public/` holds `dendrite3d.jpg` (600², 17 kB), `hero.jpg` (1000×800, 64 kB) and `snowflake.jpg` (750², 57 kB). These are the no-WebGPU fallbacks. `docs/` holds the README stills. **There is no video anywhere in the repo.**
- **Serving.** Vite copies `public/` verbatim to the dist root. With `base: "./"`, a file is referenced relatively, as `snowflake.jpg` is today: `<video autoplay muted loop playsinline preload="metadata" poster="hero.jpg"><source src="hero.mp4" type="video/mp4"><source src="hero.webm" type="video/webm"></video>`. Nothing in `vite.config.ts` blocks this, and there is no `vercel.json`. Vercel serves static media with range requests.
  - **Size.** Keep it to about 2–6 MB.
  - **Reduced motion.** Honour `prefers-reduced-motion` by showing the poster only.
  - **Also update:** the hero comment at `index.html:74-79` ("#heroAct has never held a canvas").
  - **Label it as a recording.** The page elsewhere promises "growing live on your GPU right now".
  - **A side benefit:** no-WebGPU visitors finally get motion in the hero.
- **The app's recorder is real.**
  - The transport button `⏺ rec` is at `src/ui.ts:240` (toggles at `:895-896`).
  - It calls `toggleRec()` at `src/main.ts:679-697`, which runs `canvas.captureStream(60)` on `#canvas` (`main.ts:56`). That captures sim pixels only, with no UI chrome. `MediaRecorder` prefers VP9, then VP8, then plain webm, at 12 Mbps, and auto-downloads `solidify-<timestamp>.webm` on stop.
  - In 3D mode, `startTurntable()` (`main.ts:869-873`, driven at `:1643-1650`) records a **6 s 360° orbit** and stops on its own (UI note at `ui.ts:732`).
  - So a real grain-growth clip can be captured in the app today.
- **For a reproducible, seeded loop.**
  - `scripts/capture-demos.mjs` already hides the chrome and drives `__solidify.tick()` deterministically. It could be extended to screenshot a frame sequence and hand it to ffmpeg, which avoids MediaRecorder's dependence on real-time frame rate.
  - ffmpeg n4.3.2 is on PATH (`…\Python312\Scripts\ffmpeg.exe`) with libvpx-vp9, libaom-av1 and h264_nvenc/qsv/amf, but **no libx264**. Safari/iOS want H.264 MP4 for dependable muted autoplay, so either use a hardware encoder or install a full ffmpeg build.
