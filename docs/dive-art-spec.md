# The Dive — art spec (for hand-drawn vector replacements)

The landing's scroll descent ("the dive") renders five stages of scale. Each
stage's art is an inline SVG in `index.html` inside `<div class="stage">`.
Frank can replace any stage's artwork by swapping the SVG contents — the
camera math needs only the rules below.

## Rules per stage

1. **viewBox is always `0 0 1200 800`** with `preserveAspectRatio="xMidYMid slice"`
   (cover-fit: on wide screens the top/bottom ~15% may crop, on tall screens the
   left/right — keep critical art inside the central 1000×640 safe zone).
2. **Stroke-only, no fills.** Use the shared classes:
   - `class="w"`  — primary lines (light steel, 1.4px)
   - `class="d"`  — secondary/detail lines (dim slate, 1.1px)
   - `class="amber"` — accent strokes (amber, 1.6px)
   - `class="beam"` — cyan dashed (energy/beams)
   - `class="lbl"` — a `<g>` with one dashed leader `<line>` + one `<text>`
     (12px mono, auto-styled). 3–5 callouts per stage max.
3. **The reticle is the dive target.** Each stage (except the last) must contain
   the `<g class="reticle">` group: a dashed rect + corner ticks. The NEXT stage
   will appear exactly inside this rect, so:
   - the rect must have a **3:2 aspect ratio** (e.g. 150×100 or 120×80),
   - the stage div's `data-k` must equal `1200 / rectWidth`
     (150 wide → `data-k="8"`; 120 wide → `data-k="10"`),
   - `data-ax` / `data-ay` are the rect's **center** in viewBox coordinates.
   Draw whatever the reticle is "inspecting" beneath it (the die on the card,
   the specimen under the beam…) so the zoom feels motivated.
4. **What each stage depicts** (titles/copy live in `src/dive.ts` META):
   - S1 `FIELD ≈ 300 MM` — GPU card, isometric line drawing
   - S2 `FIELD ≈ 40 MM` — die/package floorplan, top-down
   - S3 `FIELD ≈ 5 MM` — electron-microscope column over a stage
   - S4 `FIELD ≈ 500 µM` — grain structure, one grain holding a dendrite
   - S5 `FIELD ≈ 50 µM` — the live sim canvas (only corner ticks + caption are SVG)
5. Don't add `id` attributes that collide with page ids; keep each stage under
   ~150 elements for paint performance (it gets scaled up to ~10×).

## How the camera works (context)

Scroll progress maps to a log-space zoom through the stage chain
(k₁·k₂·k₃·k₄ ≈ 5000× total). At each stage the camera scales toward the
reticle while panning it to screen center; the next stage rides inside the
reticle at `scale/k` and crossfades in during the last half of the zoom.
Stage 5 holds a gentle 2× drift over the live canvas. HUD (field readout,
stage counter, dashes) updates on stage change.
