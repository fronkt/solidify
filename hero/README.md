# The landing hero: a rendered dendrite, not a simulation frame

The scroll-scrubbed crystal on the SOLIDIFY landing page is a **rendered model**. It is a procedural
cubic metal dendrite built from a skeleton of paraboloid-tipped arms (six primaries along the cube axes,
side-branch rows along the four ridges of each, tertiaries on the longest secondaries), turned into one
closed surface, given a satin-steel material, and photographed by Blender's Cycles under a light rig that
starts warm and cools to neutral.
It is not output of the phase-field solver that the rest of the site runs. Its purpose is to show what a
dendrite is and to name its parts; the physics lives in the instrument, not in this picture.

## Files

| file | what it is |
| --- | --- |
| `timeline.json` | **the one source for the frame set**: frame count, `px_per_frame`, `hold_px`, the chapters, the five feature windows (each with its soft hold and label side), the poster frame, the growth-time and warmth laws, and the byte budgets (`budget_bytes`). `path_plan.py`, `render_sequence.py`, `encode_frames.py`, `preview_sheet.py`, `emerge_check.py` and `make_placeholder_frames.py` read it (through `path_plan.load_timeline`); the page and the node gates are to read it next |
| `timeline_v3.json` | the shipped v3 set (180 frames, no holds) described the same way, so `encode_frames.py --timeline hero/timeline_v3.json` still encodes the v3 masters (to the v1 manifest contract) |
| `path_plan.py` | the camera path planner (plain Python: numpy + scipy): keys, splines, re-timing by projected screen motion, caps and checks, `path.json` and a motion report; `--propose` sizes the post-growth chapters from measured costs, `--scan-keys` maps where each callout is visible |
| `dendrite_gen.py` | the geometry: skeleton model (growth laws, coarsening, necking, side-branch competition), the emergence ramp (how newborn and dying side arms are drawn), union of spheres to SDF to mesh, topology gate (one closed genus-0 surface or exit code 2), clay preview renders, features JSON |
| `mesh_recipe.py` | how a mesh is built: the generator's mesh at any t (`gen`) and the close-up mesh at t = 1 (`fine`) |
| `mesh_cache.py` | every mesh the sequence renders, built once and stored on disk, keyed by a hash of the recipe (`dendrite_gen.py` + `mesh_recipe.py` code and constants), the generator arguments, Blender and numpy; a mesh that fails the gate is never cached; also memoizes the t-independent skeleton |
| `emerge_check.py` | plain Python: every side-arm birth and death over the growth frames, measured on the drawn geometry (how far a newborn sticks out of the rest of the crystal on its first drawn frame, the per-frame rise and sink) |
| `motion_check.py` | plain Python: the planner's p90 screen motion against the same measure on every vertex of the cached meshes the frames render |
| `preview_sheet.py` | plain Python: a labelled contact sheet (frame, chapter, t, cumulative camera turn) and an optional animated-WebP flip-book of any rendered frame folder |
| `look.py` | the look: satin-steel Principled BSDF, the light rig with a warmth control (key 2600 K to 3200 K, rim 6000 K to 7000 K, fill 4800 K to 6000 K, a faint 3400 K bounce card that fades out), the Filmic view; any lamp can be placed in its own frame (the sequence's trailing key). The blackbody emission of the earlier rounds is still in the file behind `emission`, which the sequence sets to 0 |
| `render_sequence.py` | the frame set along `path.json`: one mesh per growth frame and the close-up mesh for every frozen frame, all from the mesh cache, warmth, the trailing key, anchors (projection + ray casts on the mesh), the feature points for the planner (`--features-only`), `--cache-only`, an EEVEE preview of the real look (`--preview`), a Workbench framing mode; refuses stale or failed paths and gate failures; resumable with a render key per frame |
| `topo_check.py` | topology audit (one closed genus-0 surface) of any generator module's stages, or with `--fine` of the close-up mesh |
| `encode_frames.py` | plain Python: composites the transparent masters onto `#0a0b0d`, writes the WebP sets, the posters, `manifest.json` and a contact sheet, through a staging folder swapped in at the end |
| `make_placeholder_frames.py` | stand-in frames written to the same contract before a render exists |

Masters, meshes, the path, reports and scratch go to `C:/Users/frank/solidify-hero-out/v4/`. `encode_frames.py` writes
the v4 set to `v4/public_hero/` by default; `public/hero/` (what the page serves today: the v3 set, manifest version 1)
is written only once the page and its gates read the v4 contract (manifest version 2, `px_per_frame`, holds, 778 frames).

## The frame set (v4)

778 square opaque WebP frames on `#0a0b0d`, in two sizes, plus a poster and a manifest; the page pins
`778 x 10 = 7,780` px of scroll to them, then holds the last frame for 560 px (8,340 px in all, inside the storyboard's
7,500-8,700 px band). All of it is `timeline.json`:

* `seed` 0-35, `grow` 36-155, `branch` 156-275 (the storyboard's 36 / 120 / 120 frames): growth time t runs
  **linearly** from 0.03 (the bare nucleus) to 1 over frames 0-275, so the tips advance at the constant speed the
  generator models; the nucleus bulges into six buds within the seed, the side branches bud and coarsen through grow and
  branch. Every frame has its own mesh (the same seed at its t, from the mesh cache). The light stays warm (key 2600 K,
  a faint warm bounce from below).
* `cool` 276-338: the light rig eases to neutral (key 3200 K, rim 7000 K, bounce off); the camera hands over from the
  orbit to the tour and moves in on the +x arm. **The crystal no longer changes from here on** (see the claims below).
* `tour` 339-638: five callouts in the order `primary` (339-373), `tip` (419-455), `lambda2` (477-513), `tertiary`
  (541-577), `neck` (602-638), each window its 17-frame soft hold and 10 frames either side (the camera never stops, it
  slows to ~3.3 px of screen motion per frame); between windows the camera glides and no callout shows.
* `pullback` 639-777: back to the whole crystal, stopping on the poster pose, frame 777, a real render.

**Byte budget (owner's decision pending).** `timeline.budget_bytes` keeps v3's per-frame budget for 778 frames: 1200
set 54,386,090 B (51.9 MiB), 600 set 15,862,642 B (15.1 MiB), poster 400 KiB. That is 4.3x v3's set budgets (12 / 3.5
MiB) and ~7x v3's shipped 7.2 MB (v3 re-encoded here: 6.87 MiB). The storyboard's delivery plan (AVIF at 1200, a 900
set as the desktop default, prefetch by chapter, the first pass every 16th frame) is page work, not done yet.

**Every frozen frame (275 on, t = 1) renders the close-up mesh**, built once. It is not only the generator's t = 1 mesh
at a finer resolution: the same crystal on a 0.002 SDF grid instead of 0.004, with 4 smoothing passes instead of 2, and
a sphere of up to 0.008 behind every living tertiary's apex (capped by the arm's own envelope), so tertiary tips read
round in close-ups (up to 1.48x blunter than their 0.0054 tip radius). The mesh therefore changes once, between frames
274 and 275, the last growth step, at the full view. Measured with a fixed camera (frame 275's, Cycles, 1200 px, 96
spp; `v4/ab_swap/`): the change alone moves 26.3 % of the crystal's pixels by more than 24/255 (9.4 % by more than 48;
mean 19.9; silhouette +3.5 %), while the step 274 -> 275 itself moves 51.3 % (29.4 %; mean 40.7) and would move 46.2 %
(26.6 %; mean 37.1) without the change: the change adds about a tenth to that one step, and in stills side by side
(`v4/ab_swap/swap_ab_crops.png`) the generator mesh's pointed tertiary tips turn round. Spreading it (building the
close-up recipe for the last ~16 growth frames and ramping the tip spheres in) would cost ~1 h more of mesh builds and
still leave the resolution step on one frame; not done, the owner's call.

**Features** (the five callout points; `v4/features.json`). The look-at slides from the tip toward the root (tip, then
each callout nearer the root), so the picks keep that order along the +x arm (L = 1.01): the tip (x 1.01); the lambda2
pair, two adjacent still-growing secondaries of the -y row at 0.67 / 0.71 L (arms 42 / 43, spacing 0.038, an open
liquid channel between them); the tertiary, arm 830, 0.048 long, pointing -y from the +z secondary at 0.63 L; the neck,
the root of that same +z secondary (arm 62, 0.63 L), whose silhouette waist on the close-up mesh is 0.915 of the
section above it. Nearer the root no neck reads on the mesh: of the 25 +x secondaries between 0.25 and 0.60 L that
protrude more than 5 tip radii, 11 keep no model neck and 14 keep a shallow one (11 of them 10-26 tip radii long).
`apply_neck_limits` cuts the age law's necks (k 0.34-0.41) down to at most 0.23 as row neighbours approach, the floor
radius limits the channel-capped arms, and the closing fills the rest, so their mesh waist / section-above ratio is
0.94 or more (the pick needs under 0.92). The only clearer waist, arm 63 at 0.67 L (0.87), has no tertiary at or
tipward of it, so taking it would send the look-at back toward the tip between the tertiary and the neck.

`manifest.json` (version 2) carries, per frame and per feature, the anchor the page draws its callout at:
`[x, y, visible]` for a point, `[x1, y1, x2, y2, visible]` for a pair, x and y as fractions of the frame from the
top-left, plus `px_per_frame` and `hold_px` (the pin is `frames x px_per_frame` of scroll, then the hold), and each
feature's `hold` and `label` side. `primary` is two points on the +x arm's axis (root side, tip side) for the ⟨100⟩
arrow; `lambda2` is the roots of two adjacent secondaries in one row for the spacing bracket. `visible` is 1 when a
ray from the camera reaches the point without meeting another part of the crystal first (Blender `scene.ray_cast`,
with the point's own distance to the surface allowed) and the point sits clear of the page's 6 % edge fade. Frames
before the crystal has reached t = 1 carry `visible = 0`: those features do not exist yet. `poster` is the last frame,
the pull-back's end pose, with all five features visible; it is the still for reduced motion and for no JavaScript.
A v3 timeline (`timeline_v3.json`) writes manifest version 1 exactly as shipped (checked: every key equal).

## Meshes: the emergence ramp and the cache

**Emergence ramp** (`dendrite_gen.emerge_shift`, drawn geometry only). A side arm switches on when it protrudes half a
tip radius beyond its parent; v3 drew it at once, and a tertiary whose host stopped and remelted vanished at once when
the host's retreating tip reached it (61 tertiaries in the last 34 growth frames, up to 14 tip radii long). Now the
drawn protrusion is a smooth function of the true one: 0.35 tip radii inside the parent at the switch-on, a C1 cubic
that leaves with zero speed and joins the true protrusion 2 tip radii later, with its input capped by the parent tip's
lead over the station (gain 1, minus one tip radius), so an arm on a retreating host retracts ahead of the tip and is
buried before it dies; `sample_arm` also keeps the single station of a short drawn arm (v4 drew nothing until a
newborn's apex was ~1 tip radius out, then the whole cap at once). The tip radius keeps its blunt-to-sharp law; only
protrusion is ramped. The skeleton and every rule that tests geometry (clearance, channel caps, necks) see the
undrawn arms, so the t = 1 crystal's caps, drops and necks are v3's. **Measured over every birth and death** of the
276 growth frames (`emerge_check.py`, the union of spheres before the closing, so a little conservative;
`v4/emerge_check.json`): 8 of 1,891 births stick out of the rest of the crystal on the first frame they are drawn, by at
most 0.06 tip radii (0.0003 model units, 0.16 px at the full view); all 67 deaths are buried on their last drawn frame;
a surfacing arm rises at most 0.73 tip radii in one frame, and a tertiary retracting on a remelting host sinks at most
1.32 in one frame. With v4's ramp (1 tip radius, 0.25 deep, gain 2) and sampler, 492 of 1,889 tertiary births stuck out
by up to 0.77 tip radii (2 px), and the worst sink was 1.78.

**Mesh cache** (`mesh_cache.py`, default root `v4/cache/mesh/<fingerprint>/`). One `.npz` per (kind, t): the
generator's mesh for each growth frame, the close-up mesh for t = 1. The fingerprint hashes the recipe only: the code of
`dendrite_gen.py` and `mesh_recipe.py` (their syntax trees without docstrings, so a comment edit keeps the cache and any
code edit drops it) and the live values of their constants, every generator argument that shapes the crystal, Blender's
and numpy's versions; an edit to the cache's own I/O keeps every mesh. Each file also stores its full key, checked on
load with its array sizes and edge count. Every mesh is gated when built (one closed genus-0 surface); one that fails is
never cached, the renderer stops on it (exit code 2; `--gate-soft` renders it with a warning) and `--cache-only` exits
2. Files are written under a per-process temp name and renamed in (retried while another process holds the file), so a
preview and a render may share the cache. `--no-cache` touches nothing on disk; `--prune-cache` deletes superseded
fingerprint directories. Measured on the Arc 140V (2026-09-24): a growth mesh builds in 0.8 s (t 0.03) to 31 s (t 1),
~50 min for all 274 growth times plus the skeleton (~1-1.3 min per process); the close-up mesh in 1.5-3 min (2.22 M
vertices); a cached growth mesh loads in ~0.1 s, the close-up mesh in ~1 s. Gate so far: the close-up mesh and 13
growth times (t 0.034, 0.072, 0.115, 0.157, 0.242, 0.347, 0.453, 0.580, 0.700, 0.806, 0.912, 0.9965, 1.0) are one closed
genus-0 surface; `--cache-only` gates the rest.

## The camera path

`path_plan.py` plans the camera offline, once, and writes `path.json` (one camera state per frame);
`render_sequence.py` only reads it, and refuses one that failed the check or was planned for another timeline, other
feature points or another generator. One continuous move, one way, stopping only on the last frame. The path parameter
is the arc length of the view direction, so the turn rate is continuous across every hand-over.

* growth (0-275): a level orbit about the vertical, 540 degrees of azimuth, elevation on one slow swell (17 degrees at
  the seed, 13 early in grow, 33 at the hand-over; a 700-degree period, so the cube-symmetric crystal never repeats a
  view a quarter turn later). The frame widens with the growth law: through the seed a log-rate dolly (the ln-width cap
  binds there), then the crystal's bounding circle climbs linearly in frame from 30 % to 86 % of the frame, so the
  crystal's size on screen (the tips' outward speed, growth and dolly together) grows evenly: 1.15 px/frame, 0.98-1.38
  from frame 43 to 275 (the first v4 dolly, ln W = a ln e + b throughout, slowed it 2.3x). Growth alone, seen by a fixed
  camera, still slows as dt / t
  falls (4.7 px/frame in the seed, 2.2 in grow, 1.7 in branch): it could stay even only if the camera stopped
  receding, which the ln-width cap and the seed framing rule out.
* cool (276-338): the orbit blends into the tour's lathe (the extended orbit and the extended lathe, 18 degrees each),
  the look-at slides onto the +x arm and the lens goes from 55 to 70 mm once (a monotone channel, no overshoot); the
  turn eases from the orbit's 0.9 deg/frame to the first hold's while the screen speed rises from the growth's 5.7 px to
  the cap over the first third of the chapter.
* tour (339-638): a lathe orbit about the +x trunk (lathe angle 30 to 174 degrees, keys at 50, 78, 105, 132, 160,
  chosen from `--scan-keys` maps of where each callout is visible), the trunk held at one screen angle (roll computed,
  never keyed), the look-at low in the frame (0.55-0.62 of its height) so the crystal's mass above the trunk stays in
  frame; in the holds the crystal's lower edge sits at 0.75-1.00 of the frame height (the review measured 0.58-0.71).
* pullback (639-777): from the lathe's exit the camera follows a track on the view sphere that leaves on the lathe's
  heading (down, past the top of the arm) and turns it smoothly through "toward lower azimuth" to up-and-over (165
  degrees of heading over the first 80 % of a 65-degree track); every pose that shows all five callouts lies above the
  lathe's exit, so the heading must come round, and a turn inside ~2 degrees of arc read as a bounce (the picture's
  flow swung ~120 degrees in two frames). The roll keeps the lathe's ~162-degree dutch (a floating cubic crystal has no
  up; unrolling it at the 1 deg/frame roll cap would cost ~140 frames). The track ends on the poster: azimuth -98.7,
  elevation 15.9, all eight neighbouring poses also show all five (searched over 1,275 tracks, 119 end on such a pose).
* the key light trails the camera: each frame it turns 0.4 of the camera's own rotation (rim, fill and bounce stay on
  the camera), anchored equal to the rig at the lambda2 hold; it stays within 26 degrees of its designed place through
  every hold and the poster (24 degrees), and swings round behind the crystal and back during growth (up to 148
  degrees off at frame ~85), so the highlights move over the turning crystal. `--key-on-camera` renders the old
  camera-locked key for an A/B.
* timing: frames are spread by projected screen motion, the 90th percentile of ~5,000 points inside the frame: the
  close-up mesh's own vertices on frozen frames (within 0.99-1.01 of every vertex, `motion_check.py`), the growth
  meshes when all are cached (`--growth-points`), otherwise a surface sample of the generator's sphere sets (within
  0.94-1.16 of the meshes). Steady through growth, soft holds at 3.3 px per frame, glides that accelerate and brake
  smoothly, a braked stop on the poster; each frame's turn stays within 18 % of the previous frame's.

Checks (the planner exits 1 and leaves `path.json` alone when one fails; `v4/path_report.txt`), final path
2026-09-24: p90 screen motion max 11.77 px per frame (cap 12; at most 11.70 on every vertex of the rendered meshes over
51 sampled frames, `v4/motion_check.json`), median
5.68, max / median 2.07 (under 4; v3: 46); ln width step max 0.022 (cap 0.03); roll (twist about the view axis) max
0.963 deg per frame (cap 1); turn rate never changes by more than 18.0 % in one frame (check: 25 % above 0.1
deg/frame); the picture's flow (median screen displacement) never changes by more than 1.47 px in one frame (check:
2.5 px; the bounce measured 5.5); holds 3.19-3.37 px per frame, 17 frames each; every anchor visible through its whole
window and hold (Blender ray casts on the close-up mesh); all five on the poster; the look-at along the arm 1.01, 0.69,
0.63, 0.63, 0.

| chapter | frames | turn (deg) | storyboard | deg/frame (mean) |
| --- | --- | --- | --- | --- |
| seed | 0-35 | 107.0 | 120 | 3.06 (capped at 3.4) |
| grow | 36-155 | 251.2 | 240 | 2.09 |
| branch | 156-275 | 126.7 | 120 | 1.06 |
| cool | 276-338 | 35.5 | 40 | 0.56 |
| tour | 339-638 | 110.4 | 110 | 0.37 |
| pullback | 639-777 | 74.8 | 70 | 0.54 |
| all | 0-777 | 705.5 | 700 | |

The seed is 13 short of the storyboard because its turn is capped at 3.4 deg/frame (OMEGA_MAX) and by the roll cap; the
cool chapter's 35.5 is what its 37 degrees of hand-over arc allow in 63 frames.

## Reproduce

Blender 4.5.11 LTS portable at `C:/Users/frank/blender-portable/blender-4.5.11-windows-x64/blender.exe`,
Cycles on the Intel Arc 140V through oneAPI (falls back to CPU). System Python 3.12 with numpy, scipy (the planner),
Pillow and matplotlib (the report plot).

Run these from the repo root, in `cmd`:

```bat
set BLENDER=C:/Users/frank/blender-portable/blender-4.5.11-windows-x64/blender.exe
set V4=C:/Users/frank/solidify-hero-out/v4

:: 1. geometry checks (no render). Every stage must be one closed genus-0 surface, else exit code 2 (about 1.5-2 min a
::    stage: each builds the skeleton; six stages ~10-13 min); the close-up mesh (~4.5 min); every birth and death of
::    the growth frames (~2-3.5 min, plain Python)
"%BLENDER%" -b --factory-startup --python hero/dendrite_gen.py -- --stages 0.03,0.2,0.3,0.6,0.93,1.0 --seed 7 --name sweep --no-render --out %V4%/sweep
"%BLENDER%" -b --factory-startup --python hero/topo_check.py -- --module hero/dendrite_gen.py --stages 1.0 --fine --strict -- --seed 7
python hero/emerge_check.py --strict --tol 0.001

:: 2. the feature points (the neck and the tertiary picked on the close-up mesh) -> %V4%/features.json (~1.5 min with
::    the close-up mesh cached, 3-5 min cold; later runs reuse the file while its key matches and stop when it is stale)
"%BLENDER%" -b --factory-startup --python hero/render_sequence.py -- --features-only

:: 3. REQUIRED before 4-8: every growth mesh into the cache, gated (exit code 2 on a gate failure); ~50 min cold,
::    resumable, log in %V4%/seq/render_log.txt
"%BLENDER%" -b --factory-startup --python hero/render_sequence.py -- --cache-only

:: 4. the camera path -> %V4%/path.json + path_report.txt / .json / .png; exit code 1 (and path_failed.json) when a check
::    fails (~5-7 min; the first run after a generator change also caches its point clouds, ~2 min more). With every
::    growth mesh cached it measures the growth frames on them; --growth-points proxy falls back to the sphere proxy
python hero/path_plan.py --plot
python hero/motion_check.py

:: 5. anchors and occlusion on the path, no rendering -> %V4%/seq/frames.json (~5 s)
"%BLENDER%" -b --factory-startup --python hero/render_sequence.py -- --anchors-only

:: 6. the preview: all 778 frames, EEVEE at 600 px with the real look (the rig, the trailing key, warmth, Filmic), 16
::    samples, into %V4%/preview_eevee; resumable. ~25 min with the cache warm (measured 1.8 s a frame, 0.1 s mesh load,
::    ~50 s shader compile on the first). Then its contact sheet and a 24 fps flip-book of every frame.
"%BLENDER%" -b --factory-startup --python hero/render_sequence.py -- --preview
python hero/preview_sheet.py --seq %V4%/preview_eevee --frames spread:48 --anim %V4%/preview_eevee/flipbook.webp --fps 24

:: 7. the sequence: Cycles, 1200 px, 96 spp. About 7-8 h with the cache warm (measured 2026-09-24: growth frames 30-35 s,
::    frozen wide 33 s, tour close-ups 31-45 s); the laptop must not sleep or install updates meanwhile. Resumable: re-run
::    the same command; a frame rendered from other inputs stops the run (--rerender-stale / --force), a truncated PNG
::    is rendered again. Log in %V4%/seq/render_log.txt
"%BLENDER%" -b --factory-startup --python hero/render_sequence.py -- --res 1200 --samples 96 --seed 7

:: 8. composite, WebP sets, posters, manifest, contact sheet -> %V4%/public_hero (staging; public/hero only once the page
::    and its gates read manifest version 2)
python hero/encode_frames.py --seq %V4%/seq --out %V4%/public_hero --contact-sheet %V4%/contact_sheet.png
```

Useful while iterating: `path_plan.py --design overrides.json --tag _x` (try a variant of any design constant
without editing the file), `path_plan.py --propose` (size the post-growth chapters from measured leg costs into
`timeline_proposed.json`; hero/timeline.json is never written by a script), `path_plan.py --scan-keys` (where each
callout is visible on the lathe), `render_sequence.py --frames 12-95/6` or `--frames spread:30` (a subset),
`--preview --out <dir> --frames ...` (a preview slice, e.g. `v4/preview_final`), `--workbench` (a Workbench framing
preview), `--refeature` (pick the features again), `--key-on-camera` (the old camera-locked key), `--no-cache` (build
every mesh, touch no cache), `--verify-cache` (re-count the topology of every mesh loaded), `--prune-cache`,
`--build-only 1.0,0.6,0.3` (mesh builds through the skeleton memo, no cache, vertex counts only; they must equal fresh
single-t builds), `preview_sheet.py --seq <dir>` (a labelled sheet of any frame folder), `encode_frames.py
--contact-only --from-masters --seq <dir>` (a contact sheet of whatever masters exist, with anchors),
`encode_frames.py --timeline hero/timeline_v3.json --seq C:/Users/frank/solidify-hero-out/v3/seq --out <dir>` (the v3
set again). Stills of the look alone: `look.py` (see its docstring).

## What the model does and does not claim

The shapes follow textbook dendrite morphology: Ivantsov paraboloid tips, fourfold ridges behind the tip,
side branches born a few tip radii behind the tip and coarsening by competition and coalescence, necking
at the roots with age, tertiaries only on the longest secondaries. The numbers are chosen to look right at
page scale, not fitted to an alloy. Growth time runs linearly with scroll through the growth chapters, so the tips
advance at the constant speed the generator models (v3 eased it out, which made them decelerate).

**Growth ends at frame 275.** The cool chapter, the tour and the pull-back show the t = 1 crystal unchanged: nothing
coarsens, remelts or thickens after growth ends (the same close-up mesh renders every frame from 275 on; a
small-amplitude continuation of the coarsening law was measured at ~0.3 px of change at the cool chapter's framing and
left out). The coarsening a viewer sees (losing side arms remelting back into their parents, survivors thickening)
happens during grow and branch. Copy for the cool chapter must not say the arms keep coarsening as it cools.

A new side branch is drawn as a bump that swells out of its parent's surface over its first 2 tip radii, and a
tertiary on a host that remelts shrinks back with the host's tip: a drawing rule for continuity between frames (a real
perturbation does start small and grow), not a measured birth or remelting rate; 8 of the 1,891 births still show
their first drawn frame outside the parent, by at most 0.16 px at the full view. The crystal does not glow: the growing
chapters are lit by a warmer rig and the cool chapter eases the lights to neutral, a photographic cue for "freezing",
not a temperature field. The key light turning more slowly than the camera is a lighting choice. Rotation and zoom are
camera only. Nothing here is a simulation result, and the page says so in its caption.
