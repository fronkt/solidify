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
| `dendrite_gen.py` | the geometry: skeleton model (growth laws, coarsening, necking, side-branch competition), union of spheres to SDF to mesh, topology gate (one closed genus-0 surface or exit code 2), clay preview renders, features JSON |
| `look.py` | the look: satin-steel Principled BSDF, the camera-space light rig with a warmth control (key 2600 K to 3200 K, rim 6000 K to 7000 K, fill 4800 K to 6000 K, a faint 3400 K bounce card that fades out), the Filmic view; one `Look` class the sequence renderer drives. The blackbody emission of the earlier rounds is still in the file behind `emission`, which the sequence sets to 0 |
| `render_sequence.py` | the 180-frame sequence: per-frame mesh rebuild through the grow chapter (the t-independent skeleton is built once and memoized), a finer close-up mesh for the tertiary and neck windows, warmth, one smooth camera path, anchors (projection + occlusion test on the mesh each frame renders), resumable, per-frame timing log |
| `topo_check.py` | topology audit (one closed genus-0 surface) of any generator module's stages, or with `--fine` of the close-up mesh |
| `encode_frames.py` | plain Python: composites the transparent masters onto `#0a0b0d`, writes the WebP sets, the posters, `manifest.json` and a contact sheet |
| `make_placeholder_frames.py` | stand-in frames written to the same contract before the render existed; `public/hero/` holds them until `encode_frames.py` writes the render over them, and `verify-hero-manifest.mjs` fails them under CI |

Outputs go to `public/hero/` (`1200/f000..f179.webp`, `600/f000..f179.webp`, `poster-1200.webp`,
`poster-600.webp`, `manifest.json`). Masters, builds and scratch go to `C:/Users/frank/solidify-hero-out/`.

## The frame set

180 square opaque WebP frames on `#0a0b0d`, in two sizes, plus a poster and a manifest.

* `seed` 0-11: a tiny steel nucleus appears under warm light (the t = 0.03 crystal scaled 0.25 to 1).
* `grow` 12-95: growth time t runs 0.03 to 1.0 with an ease-out. The mesh is rebuilt for every frame from
  the same seed, so every frame is the same crystal at a later time. The light stays warm (key 2600 K, a faint
  warm bounce from below); the camera dollies out so the crystal grows on screen from about 15 % to 78 % of the
  frame height while turning slowly (25 degrees of azimuth, 22 of elevation, never through an axis plane of the
  cube, where the crystal would read as a flat cross).
* `cool` 96-119: the light rig eases to neutral (key 3200 K, rim 7000 K, bounce off): the freeze is told with
  light, not with emission (two judge rounds rejected every glow). The turn continues to a three-quarter rest.
* `tour` 120-179: the frozen crystal tumbles from feature to feature, holding on each inside its window:
  `tip` 122-133, `primary` 134-145, `lambda2` 146-157, `tertiary` 158-167, `neck` 168-179. The close-up frames
  (158-179, framed narrower than 0.45 model units) render the same t = 1 crystal meshed on a 0.002 SDF grid instead
  of 0.004 (same skeleton, same closing and opening radii, so only the resolution changes), with a minimum
  tertiary tip radius, so tips stay round at that scale. The neck is the side arm whose root is most visibly
  necked on that mesh, measured by ray casts (the closing fills most of the model's neck), seen level from the
  front with the trunk running up the left of center and the arm reaching right.

`manifest.json` carries, per frame and per feature, the anchor the page draws its callout at: `[x, y, visible]`
for a point, `[x1, y1, x2, y2, visible]` for a pair, x and y as fractions of the frame from the top-left.
`primary` is two points on the +x arm's axis (root side, tip side) for the ⟨100⟩ arrow; `lambda2` is the roots
of two adjacent secondaries in one row for the spacing bracket. `visible` is 1 when a ray from the camera
reaches the point without meeting another part of the crystal first (Blender `scene.ray_cast`, with the
point's own distance to the surface allowed) and the point sits clear of the page's 6 % edge fade. Frames before
the crystal has reached t = 1 carry `visible = 0`: those features do not exist yet. `poster` names a tour frame
in which all five features are visible at once; it is the still for reduced motion and for no JavaScript.

## Reproduce

Blender 4.5.11 LTS portable at `C:/Users/frank/blender-portable/blender-4.5.11-windows-x64/blender.exe`,
Cycles on the Intel Arc 140V through oneAPI (falls back to CPU). System Python 3.12 with Pillow and numpy
for the encoder.

Run these from the repo root (the script and output paths are relative to it), in `cmd`:

```bat
set BLENDER=C:/Users/frank/blender-portable/blender-4.5.11-windows-x64/blender.exe

:: 1. geometry check (no render): every stage must be one closed genus-0 surface, else exit code 2; the second line
::    checks the close-up mesh (about 5 min)
"%BLENDER%" -b --factory-startup --python hero/dendrite_gen.py -- --stages 0.03,0.1,0.3,0.6,1.0 --seed 7 --name sweep --no-render
"%BLENDER%" -b --factory-startup --python hero/topo_check.py -- --module hero/dendrite_gen.py --stages 1.0 --fine --strict -- --seed 7

:: 2. the sequence (about 2 h 10 min on the Arc 140V: ~5 min of setup (skeleton, both t = 1 meshes), 25-38 s per
::    frame to render, 40-65 s on the close-up mesh (158-179), plus 1-40 s to rebuild the mesh through the grow
::    chapter; resumable, re-run to continue; --force re-renders; log in <out>/render_log.txt)
"%BLENDER%" -b --factory-startup --python hero/render_sequence.py -- --out C:/Users/frank/solidify-hero-out/v3/seq --res 1200 --samples 96 --seed 7 --frames 0-179

:: 3. composite, WebP sets, posters, manifest, contact sheet
python hero/encode_frames.py --seq C:/Users/frank/solidify-hero-out/v3/seq --out public/hero --contact-sheet C:/Users/frank/solidify-hero-out/v3/contact_sheet.png

:: 4. the browser-free gate
node scripts/verify-hero-manifest.mjs
```

Useful while iterating: `render_sequence.py --preview` (400 px, every 6th frame, into `<out>_preview`),
`--anchors-only` (schedule and anchors without rendering), `--frames 12-95/6` (a subset),
`--build-only 1.0,0.6,0.3` (mesh builds through the skeleton cache, vertex counts only; they must equal fresh
single-t builds), `encode_frames.py --contact-only --from-masters --seq <dir>` (a contact sheet of whatever
masters exist). Stills of the look alone: `look.py` (see its docstring).

## What the model does and does not claim

The shapes follow textbook dendrite morphology: Ivantsov paraboloid tips, fourfold ridges behind the tip,
side branches born a few tip radii behind the tip and coarsening by competition and coalescence, necking
at the roots with age, tertiaries only on the longest secondaries. The numbers are chosen to look right at
page scale, not fitted to an alloy. The crystal does not glow: the growing chapters are lit by a warmer rig and
the cool chapter eases the lights to neutral, a photographic cue for "freezing", not a temperature field.
Nothing here is a simulation result, and the page says so in its caption.
