# Brief: the SOLIDIFY landing-page hero dendrite (render the frame sequence)

You are producing the hero asset for SOLIDIFY (repo: `C:\Users\frank\solidify`, a WebGPU phase-field
solidification instrument; audience: materials-science students, PhD students, professors). The owner
asked for a high-fidelity dendrite modeled and rendered in Blender, in the style of oryzo.ai (Lusion):
one object centered on a dark canvas that turns as the visitor scrolls, with its features called out.
The web page that plays it is ALREADY BUILT and committed. Your job is only the frames.

## What exists

- Page: `src/hero.ts`, `index.html` (#heroAct), gates `scripts/verify-hero-manifest.mjs` (browser-free)
  and `scripts/verify-hero.mjs` (browser). DO NOT EDIT these. They define the contract; read them first.
  If you believe the contract is wrong, stop and explain in your final message instead of changing it.
- `public/hero/` currently holds PLACEHOLDER frames and a placeholder manifest. You overwrite all of it.
- `hero/dendrite_gen.py`: procedural cubic-dendrite generator (Blender Python), "v1". This is the base
  to keep. `hero/look.py`, `hero/render_sequence.py`, `hero/encode_frames.py`, `hero/README.md`,
  `hero/make_placeholder_frames.py` were written against a later "v2" generator (archived at
  `C:\Users\frank\solidify-hero-out\archive\dendrite_gen_v2.py`) whose API differs (v2 has `build()`;
  v1 does not). Adapt or rewrite them as you see fit.
- Blender 4.5.11 LTS portable: `C:\Users\frank\blender-portable\blender-4.5.11-windows-x64\blender.exe`.
  Headless: `blender.exe -b --factory-startup --python script.py -- args`. Cycles GPU works through
  oneAPI on the Intel Arc 140V: `prefs = bpy.context.preferences.addons['cycles'].preferences;
  prefs.compute_device_type = 'ONEAPI'; prefs.get_devices(); enable all devices;
  scene.cycles.device = 'GPU'`. Roughly 15-25 s per 1000 px frame at 64-96 adaptive samples + OIDN.
- System Python has numpy, PIL, scipy, scikit-image, tifffile.

## What earlier rounds learned (judged by independent reviewers; please use it)

- v1 geometry (the current `hero/dendrite_gen.py`, seed 7) reads beautifully at page scale: dense
  fir-tree side branches on six arms. See `C:\Users\frank\solidify-hero-out\look_satin-steel\satin-steel_hero.png`
  and `C:\Users\frank\solidify-hero-out\page_shots\desktop_p0.75.png` (the page using a v1 still).
  Its real defects: see-through pinholes and bridges at secondary-arm roots along the trunk
  (`...\look_satin-steel\satin-steel_close.png`; cause: tertiaries aimed at a neighboring secondary fuse
  with it), tertiaries too dense and uniform ("bottle brush"), newborn branches a bit bead-like.
- v2 tried to fix those and got worse: sparse, constant-width, hemispherical-capped secondaries that
  read as pills or "toy airplanes", crease seams at the six-arm junction. Do not go that way.
- Incandescent glow during growth was rejected twice: it read as glazed candy / yellow plastic, and a
  hot-tips-cold-trunk gradient is wrong physics (a growing crystal is nearly isothermal). Use no emission.
- Material that won: neutral satin steel (midtone R/B about 1.10-1.15, not rose gold), roughness about
  0.22-0.30 without fine roughness noise, warm key (~3200 K) raking from upper right across the side
  branches, cool rim (~7000 K) from behind left, a large dim fill so no surface goes pure black.
  Specular clipping under ~1.5% of object pixels. Polished/mirror nickel read as glitter at page scale.
- Real X-ray tomography of an Al-Ge dendrite was tried and looks like a crumpled rock at 2.75 um
  voxels; not usable.

## Morphology the model must respect (cubic, non-faceted metal, equiaxed)

Six primary arms along <100>, roughly equal; paraboloid (Ivantsov) tips; the trunk behind the tip stops
widening a few tip radii back; four rows of secondary arms per primary along the perpendicular <100>s;
side branches start as small swellings a few tip radii behind the tip and are longer, coarser and uneven
further back (coarsening, competition); secondaries have their own rounded tips and taper; tertiaries
only on the longest secondaries, along <100> perpendicular to their parent; secondary roots necked;
spear-shaped arm envelopes; smooth surfaces, no facets, no pinholes, no bridges. The mesh must be one
component with genus 0 at every growth stage you render (check the Euler characteristic).

## What to deliver

1. Geometry: keep v1's character; fix the pinholes/bridges, thin and vary the tertiaries modestly,
   make newborn branches blend in as swellings. Keep the growth-time parameter (every skeleton point has
   a birth time) and the per-feature points the page needs.
2. Look: the winning satin steel above. Tell the "freeze" with light only: during seed/grow the key and
   rim are warmer (key ~2600 K, faint warm bounce); across the cool chapter they ease to the neutral
   setup. The metal must always read as steel. Transparent film, then composite onto exactly #0a0b0d.
3. The sequence, exactly to the contract in `src/hero.ts` + `scripts/verify-hero-manifest.mjs`
   (and `tasks/todo.md` section "H · Hero"): 180 square frames; chapters seed 0-11, grow 12-95
   (growth time 0.03 -> 1.0 while the camera eases out so the crystal grows on screen from ~15% to
   ~78% of frame height), cool 96-119, tour 120-179 with feature windows tip 122-133, primary 134-145,
   lambda2 146-157, tertiary 158-167, neck 168-179. In the tour each feature is large and clear in its
   window, with its anchor on the side of the frame away from where labels go (labels go LEFT for
   tip/primary and RIGHT for lambda2/tertiary/neck). Resting angles are three-quarter views, never a
   head-on fourfold view. Smooth camera and object motion, no jumps between consecutive frames.
   Per-frame anchors (normalized 0..1, origin top-left) for each feature, with a visible flag from a
   Blender ray cast from the camera; "primary" is a pair along one primary arm axis (root, tip);
   "lambda2" is the roots of two ADJACENT secondaries in the same row. A poster frame from the tour with
   all five features visible, and its anchors. Opaque WebP, 1200 and 600 sets, posters, manifest.json,
   within the byte budgets the manifest gate enforces. No "placeholder" marker in the final manifest.
4. Render the FULL sequence yourself, to completion, in this session. Do not start it in the background
   and finish your turn: if you end, your processes die. Make the renderer resumable (skip frames whose
   master PNG exists) and render masters to `C:\Users\frank\solidify-hero-out\astra\seq\`.
   Before the full run, render a handful of frames across all chapters, look at them, fix, and only then
   commit to the full run.
5. Look at your work: open rendered frames as images and check them (material, framing, continuity,
   anchors on the right features). Make a contact sheet of every 6th frame with anchors drawn and frame
   numbers printed at `C:\Users\frank\solidify-hero-out\astra\contact.png`.
6. Run `node scripts/verify-hero-manifest.mjs` from the repo root with `CI=true` set in the environment
   (the gate rejects placeholder frames under CI). It must pass. Report its output.
7. Update `hero/README.md`: what the asset is (a rendered model built from dendrite growth rules, not
   simulation output), and exact commands to reproduce it. American spelling in comments and docs.

## Rules

- Write files only in `hero/`, `public/hero/`, and `C:\Users\frank\solidify-hero-out\astra\`.
- Do not run git commands that change state (no add, commit, stash, checkout, reset, restore). Other
  sessions share this working tree.
- Do not edit `src/`, `index.html`, `scripts/`, or anything else outside the three places above.
- Do not start a dev server on port 5199.
- Finish with a short plain report: what you changed in the geometry, render time, frame sizes,
  the manifest gate's output, and anything you are unsure about. Also write that report to
  `C:\Users\frank\solidify-hero-out\astra\REPORT.md`.
