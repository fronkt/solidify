# Hero delivery contract (manifest version 3)

2026-09-25, hero v4 plan item A5. This is the contract between the encoder (`hero/encode_frames.py`), the page
(`src/hero.ts`) and the gate (`scripts/verify-hero-manifest.mjs`, in CI). `hero/timeline.json` is the frame
contract: N, chapters, feature windows, px per frame, budgets. This document covers everything that gets from the
masters to a visitor. The measurements behind every choice are in `solidify-hero-out/v4/a5/` (`delivery.md`,
`flow.json`), outside the repo.

## What ships

```
public/hero/
  manifest.json                    stable name, revalidated on every visit, written last
  poster-1200.avif                 stable name, revalidated: the last frame (no-JS, reduced motion, the still)
  poster-1200.webp                 the same frame for browsers without AVIF, and the <img> in index.html
  v4-<hash>/                       immutable, content-hashed: nothing in it ever changes under its name
    1200/first.bin                 first-pass segment: every 16th frame plus 0 and N-1 (50 frames)
    1200/000-031.bin ... 768-777.bin   contiguous segments, 32 frames each (the last one 10)
    900/...  720/...               the same layout per set
```

Nothing else may be in `public/hero`. The encoder deletes anything else after the swap, including earlier hashed
directories and v3's `1200/`, `600/` and `poster-600.webp`. The gate fails on strays.

A segment is the frames' AVIF files back to back, with no container of its own (`.bin`, served as
`application/octet-stream`). The manifest gives each segment's frame list and an `[offset, length]` per frame. The page
fetches a segment once, slices it, and decodes each slice as its own image:

```js
const buf = await (await fetch(`hero/${m.dir}/${seg.file}`)).arrayBuffer();
seg.frames.forEach((i, k) => {
  const [off, len] = seg.index[k];
  blobs[i] = new Blob([new Uint8Array(buf, off, len)], { type: set.type });   // then createImageBitmap(blob)
});
```

## The sets

| set | format | quality | bytes (all files) | frames only | first pass | budget | who gets it |
|---|---|---|---|---|---|---|---|
| 1200 | AVIF | 60 | 31.05 MiB | 29.19 MiB | 1.86 MiB | 34.19 MiB | DPR-2 laptops and desktops (need 1402-1862 px; the 1200 px masters cap them) |
| 900 | AVIF | 60 | 22.36 MiB | 21.02 MiB | 1.34 MiB | 24.62 MiB | DPR-1 1920 and 2560 screens, iPad portrait, Windows at 125-150 % |
| 720 | AVIF | 62 | 17.62 MiB | 16.56 MiB | 1.06 MiB | 19.44 MiB | phones, DPR-1 laptops 1280-1440 wide |

- **Codec:** AVIF through Pillow 12.2.0 and libavif 1.4.1 (aom encoder), speed 4, 4:2:0, full range. The composite is
  straight-alpha over `#0a0a0a` in display space, as a browser composites the transparent PNG, and the set is Lanczos
  from the 1200 composite. Each quality is the lowest at which no sampled frame (48 across every chapter) falls more
  than 0.002 masked SSIM below the approved WebP q76 look. That is 17-19 % smaller than WebP q76. The background
  decodes to exactly `#0a0a0a` in Chrome.
- **Pick rule (the page):** need = canvas CSS width x min(devicePixelRatio, 2). Use the smallest set that is at least
  0.9 x need, else 1200. Trade up once a resize, zoom or screen change has settled, never down: the page re-picks
  0.3 s after the last such event and, after a window resize, only once ScrollTrigger's refresh has re-laid out the
  pinned section (until then the canvas keeps its old CSS width, which at a zoom's new DPR would ask for a larger set).
  On a switch the 8 decoded frames nearest the playhead, from any earlier set, stand in until the new set has the
  frame. Measured: at 0.9 the resampled set keeps masked SSIM >= 0.978.
- **No 600 set.** It would serve only needs up to 666 px and save those visitors 2.3 MiB.
- **No WebP frame set.** The page probes AVIF once before fetching (decode a tiny inline AVIF). Without it, the page
  shows the still: the poster with the five numbered marks. If the live hero is wanted in those browsers, add ONE WebP
  900 q76 set (about 26 MiB), not a WebP copy of every set.
- **One K for every set** (32 frames), so a set switch maps a frame to the same segment. K comes from the measured
  bytes: the mean full segment is 1.26 MB at 1200, 0.91 MB at 900 and 0.71 MB at 720, inside the 0.5-1.5 MB band that
  keeps requests near 25 a set without a segment costing more than about a second on a 12 Mbit/s link. Seed segments
  are small (0.05-0.08 MB) and the densest reach 2.05 MB at 1200. The encoder warns when a set's mean leaves the band.
- **The first-pass segment** holds frames 0, 16, 32, ... 768 and 777, in that order. The page loads it first, so every
  part of the scroll has a frame within 16 before the contiguous segments arrive. Its slices are byte-identical copies
  of the same frames in the contiguous segments. That costs 6.4 % of a set on disk, and for a visitor who scrolls the
  whole way. The contiguous segments cover 0..N-1 exactly once on their own, so the first pass can be dropped
  without breaking anything.
- **Fetching (the page):** every segment is read as a stream, and each frame is handed to the decoder as soon as its
  `[offset, length]` bytes are in, so frame 0 draws from the first pass's first kilobyte. A fetch that fails for a
  reason that can pass (the network, a truncated body, 5xx, 408, 429) is tried again after 1, 2 and 4 s; a 404 is
  not. A failed segment is tried again when the playhead is inside it, at most every 10 s. A set is failed when its
  first pass, or more than a tenth of its frames, is still missing after that. While the picture is off screen
  (below the fixed header) no new segment is fetched and the decoded frames are let go.
- **Decoding (the page):** 4 decodes in flight on the main thread, no Worker. During a fling, decode only the frames
  that will be drawn. AVIF 1200 decodes at 266 fps with 4 in flight on this laptop and 117 fps one at a time.

## The manifest

`public/hero/manifest.json`: compact JSON, 155 KiB (55 KiB gzip), no timestamps.

| field | what |
|---|---|
| `version` | `3` |
| `dir` | the hashed directory, `v<timeline version>-<10 hex>` (see "Content hash") |
| `frames` | N = 778, equal to `hero/timeline.json` |
| `timeline` | `{file: "hero/timeline.json", version: 4, sha1}`: sha1 of the timeline file's bytes, the same digest `path_plan.py` and `render_sequence.py` record. It is defined over the LF file. A CRLF checkout (`core.autocrlf=true` on this machine) changes it, so the encoder refuses one and the gate names it. |
| `px_per_frame`, `hold_px` | 10.0 and 560, from the timeline |
| `background` | `"#0a0a0a"`, the page's `--bg` |
| `chapters` | `[{id, from, to}]`: seed 0-35, grow 36-155, branch 156-275, cool 276-338, tour 339-638, pullback 639-777 |
| `features` | `[{id, kind, from, to, hold, label}]` in the order primary, tip, lambda2, tertiary, neck, each with its 17-frame hold and label side |
| `anchors` | `{id: N rows}` as in v2: a point is `[x, y, visible]`, a pair `[x1, y1, x2, y2, visible]`, x/y in [0, 1] of the square, 5 decimals |
| `poster` | `{frame: N-1, width: 1200, files: [{file, format, type, quality, bytes, sha256}], anchors}`. The last frame IS the poster, with no cross-fade. `anchors` equals the last frame's rows, all five visible. |
| `steps` | `{flow_p90: [N-1], blend: [N-1], units, rule, source: {file, timeline_sha1}}`. Step i draws frame i+1 over frame i. `flow_p90` is the 90th percentile of crystal-masked optical flow, in px at 1200. `blend[i] = 1` allows the sub-frame blend (108 of 777 steps). Elsewhere the page cuts. The blend gate is picture-aware: at f = 0.5 at most 5 % of crystal pixels are off the true in-between by more than 24/255, and their 99th percentile is at most 48. |
| `sets` | `[{width, format, type, quality, bytes, segment_frames, first: {file, every, bytes, frames, index}, segments: [{file, bytes, frames, index}]}]`, largest first. `bytes` = all the set's files, the first pass included. File paths are relative to `dir`. |
| `masters` | `{res: 1200, sha256}`: sha256 over the 778 masters' own sha256s, so a set can be traced to the render it came from |
| `encoder` | the composite, resampling, codec settings and library versions |
| `source` | the generator and render (seed, Blender version, samples) |

## Content hash

`dir = "v" + timeline.version + "-" + sha256(B)[0:10]`, where B is:

1. every set file's bytes, in manifest order: for each set, `first`, then `segments` in order;
2. then the manifest file's exact bytes with `"dir":"v4-..."` replaced by `"dir":""`.

The manifest names its `dir` exactly once. It carries no timestamps, so the same masters, timeline, flow and
settings always give the same name. A re-run that changes nothing keeps the directory in place. The posters live
outside the directory but are covered through their `sha256` in the manifest. The gate recomputes the hash from the
files.

## Caching (`vercel.json`)

```
/hero/:dir(v[0-9]+-[0-9a-f]+)/:file*   Cache-Control: public, max-age=31536000, immutable
/hero/manifest.json                    Cache-Control: public, max-age=0, must-revalidate
/hero/poster-1200.avif                 Cache-Control: public, max-age=0, must-revalidate
/hero/poster-1200.webp                 Cache-Control: public, max-age=0, must-revalidate
```

- The rules do not overlap. The gate requires exactly one Cache-Control rule for each shipped path, with the right
  value, and never `immutable` on a stable name. `max-age=0, must-revalidate` is also Vercel's default for static
  files. It is stated anyway, so a later catch-all rule cannot make the manifest immutable without failing the gate.
- A revisit costs one revalidation of the manifest (a 304 when unchanged) and nothing for frames already cached.
  After a new encode the manifest names a new directory, so the old frames are never served under the new manifest.
- `vercel.json` holds only `headers`. Vercel's docs (project-configuration/vercel-json) describe `framework`,
  `buildCommand`, `outputDirectory` and `installCommand` each as a value that "overrides" its Project Setting, which
  applies only when the property is present. `builds`, when present, makes only its own outputs part of the
  deployment. None of them is used. The project's framework preset is `vite` in Project Settings (read 2026-09-25),
  so the build does not change.
- Skew: a tab opened before a deploy still holds the old manifest. Its later segment fetches then 404 on the new
  deployment, because each deployment carries only its own directory. The page's frame-failure path (the still)
  covers this. Nothing else is done about it.

## The poster and the no-JS path

- The poster is frame N-1, the pull-back's end pose with all five features visible. There is no separate poster pose
  and no cross-fade: in live mode the hold rests on the last frame of the set.
- `hero/poster-1200.webp` (q84, 74 KiB) and `hero/poster-1200.avif` (q68, 59 KiB) have stable names, revalidated like
  the manifest. `index.html` never changes per encode. Its `<img id="heroStill" src="hero/poster-1200.webp">` keeps
  working. `index.html` wraps it in a `<picture>` with `<source type="image/avif" srcset="hero/poster-1200.avif">`.
  The gate accepts that source and only that one: exactly one `<source>`, no `media`, attributes in any order.
- The poster serves no JS, reduced motion, browsers without AVIF, Save-Data, a set that fails to load, and the first
  paint of the still layouts. In live mode the canvas paints frame 0 from the first-pass segment. Frame 0 is its first
  slice, and the page reads the segment as a stream, so frame 0 is decoded before the rest arrives (verify-hero
  HERO-BOOT times it on a throttled phone link). The page never flashes the end state ahead of the seed.
- One width, 1200. The delivery study measured frame 777 at 24 KB as a 720 AVIF against 46 KB at 1200 (q60-62), so a
  phone would save about 20-30 KB. Not worth another pair of stable files.

## Budgets (`hero/timeline.json` `budget_bytes`)

`{"1200": 35848192, "900": 25821184, "720": 20381696, "poster": 86016}`.

Rule: a set's budget is its measured bytes (all its files) x 1.10, rounded up to 64 KiB. The poster budget is the
larger poster x 1.10, rounded up to 4 KiB, per file. The 10 % is headroom for a re-render of a chapter, not for a
different encode. `encode_frames.py --cache-only` prints what the rule gives for the current masters. The budgets
replace v3's per-frame rate (1200: 51.9 MiB, 600: 15.1 MiB, poster 400 KiB), which the v4 sets never approached.

The quality step-down is kept: while a set is over budget, its quality drops by 2. By default it stops at the set's
own quality (`--min-quality` lowers the floor), because the measurement put the next steps down visibly below the
approved look. So by default an over-budget set is refused, not degraded. Tested with `--min-quality 56` and a 900
budget of 22.7 MB: 900 stepped to q58 (20.46 MiB) and shipped.

Changing a budget changes the timeline's sha1. The gate then fails until the next encode. The flow file's digest
must also match: re-run `v4/a5/flow_gate.py`, which re-derives `flow.json` from its stored rows in a second.
`path.json`'s recorded digest goes stale too, so `render_sequence.py` asks for `--allow-stale` or a re-plan before its
next run. Render keys do not include the timeline, so no frame re-renders.

## The encoder

```
python hero/encode_frames.py --cache-only --stop-after 480   # fill the per-frame cache in chunks (exit 3 = re-run)
python hero/encode_frames.py                                 # assemble, hash, swap into public/hero, contact sheet
python hero/encode_frames.py --contact-only                  # redraw the sheet from the shipped set
```

- **Streaming, bounded RAM.** A pool of at most 6 processes. Each worker loads one master, composites it, encodes
  each set width and the posters, writes each result to the cache and drops it. The parent appends cached frames to
  segment files one at a time. Measured peak for all processes: 592 MiB (6 workers, 1 AVIF thread each). The v4
  staging encode held every composite in RAM (5.5 GB at 778 frames).
- **Resumable.** The per-frame cache (`solidify-hero-out/v4/encode_cache/<recipe>/<width>-<format>-q<q>/<master
  sha256>.<format>`) is keyed by the master's digest, the width, the format, the quality and the recipe (background,
  resampling, codec settings, library versions). A re-run skips done work. A deleted cache file re-encoded
  byte-identically in the test.
- **Time:** the full cache fill took 503 s of wall time on this laptop, alongside other sessions (98 s + 405 s in two
  chunks). Assembly, hash, swap and contact sheet take 5 s.
- **Staging:** under the cache folder, outside the repo. Vite's file watcher holds handles on the folders under
  `public/`, and Windows then refuses to rename them. The finished directory is moved in, the posters are replaced,
  the manifest is replaced last, and only then are old files deleted. Renames and deletes retry for up to about 50 s.
- **Refusals:** frames.json for another frame count; a missing master or one that is not 1200 x 1200; a frame without
  anchors; a mesh that failed the topology gate; a poster that is not the last frame or has an occluded feature; a
  timeline older than version 4; a CRLF timeline; a flow file that is missing, the wrong length, or made for another
  timeline or other masters; a set or poster over budget. Each was run once.
- **Dropped:** the v3 re-encode path (`--timeline hero/timeline_v3.json`, manifest v1). Keeping it meant a second
  writer, layout and swap for a set that stays in git history. `hero/timeline_v3.json` is untouched.
- **Contact sheet:** drawn from the shipped 1200 set, decoded from its segments, every 22nd frame and the last, with
  the anchors (`solidify-hero-out/v4/contact_sheet.png`), plus an encode report beside it.

## The gate

`scripts/verify-hero-manifest.mjs`, browser-free, in CI: ten checks (`HERO-MANIFEST-SCHEMA`,
`HERO-MANIFEST-ANCHORS`, `HERO-STEPS`, `HERO-SEGMENTS`, `HERO-FILES`, `HERO-IMAGE-HEADERS`, `HERO-HASH`,
`HERO-BUDGET`, `HERO-CACHE-HEADERS`, `HERO-PAGE-KEYS`). `TESTING.md` describes each. `HERO_VERIFY_ROOT=<dir>` points it
at a copy of the files. That is how 52 planted defects were run, each failing its own check
(`solidify-hero-out/v4/a5/plant/`).

## Not settled here

- Each re-encode that changes frames adds about 71 MB of new files to git. Identical files keep their git blobs across
  directory renames, so a re-encode that changes only the manifest costs little.
- Not measured on a deployment: Vercel's `Content-Type` and compression for `.bin`, and the headers as served.
  The rules are checked against Vercel's documented path-to-regexp syntax by the gate's own reader, not by Vercel.
- The flow and blend data come from scripts in `solidify-hero-out/v4/a5/`, outside the repo, and `flow.json` records
  the timeline's digest but not the masters' (`masters.sha256` is now in the manifest for that).
