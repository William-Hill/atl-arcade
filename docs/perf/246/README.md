# #246 Pbr lite: the pbr look on the phone tier

2026-11-10. Branch `claude/246-pbr-lite-phone` from `epic/city-look` (7767eab).

**Read this first.** Every frame time here is from headless Chromium with SwiftShader, a software GPU on the CPU of a 4-CPU cloud machine. They are NOT phone numbers. Use them only to compare two looks on the same machine. No run on a real phone or a real GPU was possible here. The real-phone check is open: the steps are at the end.

The owner's decision (2026-11-10): the pbr look stays on phones, in the settings menu too, as near to the full pbr look as the phone can pay for. So the phone tier's pbr look is now "pbr lite" (`src/render/pbr-lite.js`).

The audit file that the issue names (`production/audits/2026-11-playability/mobile-pbr/FINDINGS.md`) is not on `epic/city-look`. This work used the table in issue #246 and the scripts of the first mobile audit (`production/audits/2026-11-playability/mobile/scripts/`).

## Method

- `scripts/phone-look-perf.mjs`: the phone tier (`?quality=phone`) on the audit's profiles: iPhone 15 portrait and landscape and Pixel 7 portrait (the Playwright device descriptors: viewport, pixel ratio, touch, user agent; the engine is Chromium) and 360 x 640 at pixel ratio 2. The governor is off. The script waits for the late loads (the trees, the people, the cars, the murals, the ground maps), so the look is complete.
- Three views, the same in every run: `follow` (the game's own camera behind the skater at the spawn), `spawn` (a fixed camera on the trail under two tree crowns), `krog` (a fixed camera at Krog Street Market: a mural wall, brick storefronts, a car). The people and the cars stay in the frame.
- The frame time is the median of 5 frames, read from one `requestAnimationFrame` to the next with a 1-pixel `readPixels`, so the software GPU completes each frame (the method of `scripts/leaf-perf.mjs`). Run to run, the same build moves by about 50 ms (the two "(all)" rows of a split differ by 20 to 70 ms).
- `scripts/phone-look-split.mjs`: the frame with one kind of object hidden at a time (the method of `docs/perf/191/README.md`).
- "Pbr before" is the same build with `?pbrlite=0`: the phone tier's pbr look as it was on `epic/city-look`.
- The audit's own method (the W key held, the median of the `requestAnimationFrame` times with no `readPixels`) is the script's default mode. It gave 10 or 11 frames per pbr run and moved a lot from run to run (the same look gave 1267 ms and 3117 ms), and a sample taken 3 s after the game is ready, before the late loads, gave 17 ms for pbr. So the tables below use the fixed views. One pass of that ride on an earlier build of this branch (before the ground cut): before 7.9x to 10.7x toon, pbr lite 6.0x to 8.7x.

## Ranked costs (measured before any cut)

iPhone 15 portrait profile, phone tier, canvas 589 x 988 (pixel ratio 1.5). Toon is 135 to 180 ms in every view.

| Rank | Cost | Where measured | ms | Part of the extra frame (pbr minus toon) |
|---|---|---|---|---|
| 1 | The leaf cards of the Blender trees (300 to 520 cards a tree, each cut with `discard`) | `spawn`: 1257 ms, 382 ms with `?trees=kit` | 875 | 79 % (the extra frame is 1110 ms) |
| 2 | The pbr ground shader (toon ground: 14 ms) | `follow`, pbr lite split: 837 ms, 436 ms with the ground hidden; `krog` before: 604 to 357 ms | 250 to 400 | 40 to 50 % of what is left after the trees |
| 2a | of which: the second, larger albedo sample against the tile repeat | `follow`: 799 to 674 ms | 125 | |
| 3 | The walls (the facade shader as a standard material) | `krog` split: 604 to 450 ms | 154 | |
| 4 | The other props (lamps, benches, the tree trunks and crowns without cards) | `krog` split | 109 | |
| 5 | The GLB cars | `krog` split 44, `follow` split 93, `spawn` `?carglb=0` 44 | 44 to 93 | |
| 6 | The Meshy people (rigs and baked crowd) | `spawn` `?pedglb=0`: 63; `follow` split 62 | about 60 | at the noise |
| 7 | The grade pass, the height fog, the landmark GLBs | `spawn`: `?pbrgrade=0` 90, `?heightfog=0` 88, `?landmarkglb=0` -6 | under 90 each | inside the noise |

What is NOT a cost on the phone tier:

- **Render passes.** The phone tier draws one scene pass and one fullscreen grade pass (`drawSplit`: every draw is in `main`). There is no shadow map, no GTAO, no bloom and no MSAA on this tier (they are high-tier features), so there was nothing to cut there.
- **The sky light.** It already reads 9 spherical harmonics (#191). With the env map lookup back (`?skysh=0`) the `spawn` frame is 1828 ms, not 1257 ms.
- **Draw calls and triangles.** Pbr draws 7 to 17 more calls than toon and up to 33 % more triangles in the `follow` view (the Meshy people, the GLB cars, the landmark GLBs). The frame time does not follow them: the `krog` view has the fewest of both and the same pbr / toon ratio as before the tree cut.
- **Texture count and memory.** 165 to 172 textures against 82 to 90, and an estimate of 345 to 352 MB against 241 MB (`src/perf/texture-memory.js`: width x height x layers x bytes, plus a third for mips; an estimate, to compare looks only). The largest pbr-only texture was the 2048 px mural atlas (22 MB with mips). Both looks hold a 1024 x 4096 street sign atlas (22 MB).
- **Download.** 15.77 MB and 213 requests against 7.49 MB and 134 (the audit's numbers, to the byte). By group (`docs/perf/190/pbr-downloads.md`): the Meshy people 3.97 MB, the landmark GLBs 1.43, the cars 1.09, the Blender trees 1.02, the mural atlases 0.89, the pbr ground maps 0.31.

Raw data: `ablation-before.json` (one part off at a time), `split-krog-before.json`, `split-follow-lite.json`, `split-follow-toon.json`, `tree-candidates.json`, `ground-cuts.json`.

## What pbr lite cuts, and what it keeps

| Cut | Why | Result |
|---|---|---|
| The Blender trees go. The trees are the procedural species trees (the shapes and the season colors of the toon look, lit as pbr props) with a solid crown and **6 leaf cards on each crown puff** (`treeTemplate(..., { cards: 6 })`), with the baked leaf cut of #191. | Rank 1. | `spawn`: 1209 ms to 654 ms (no cards at all: 450 ms; the full 18 cards a puff: 793 ms). 6 cards keep a leafy edge on the crowns. The 6 Blender tree GLBs do not download (1.0 MB). |
| The ground scans keep the albedo and ORM samples and lose the second, larger albedo sample (`GROUND_CUTS.oneAlbedo`). | Rank 2a. | `follow`: 799 to 674 ms. The two frames look the same at skating height. |
| The painted mural atlas is 1024 px (`assets/murals/mural-atlas-1024.jpg`, a downscale of the 2048 px atlas). | Texture memory and download (the tier table of `docs/art-direction-pbr.md`, section 8). | 22.4 MB to 5.6 MB of GPU memory, 0.88 MB to 0.25 MB to download. |

Kept, because they make the look read as pbr: the standard materials and the palette albedos, the grade pass (time of day, district tint) with no toon ink, the sky light (9 SH), the ground scans, the fog, the painted murals, the Meshy people, the GLB cars, the landmark GLBs, the skater rim light, the comic effects.

Tried and not kept (inside the noise, so the look keeps them): the mean roughness and AO in place of the ORM sample (-12 ms), a lawn with no slow value and hue change (-18 ms), ground anisotropy 1 in place of 2 (-35 to -55 ms, and a softer trail in the distance).

Not done: 512 px textures for the Meshy people (the tier table's target). The people are the largest pbr download left (3.97 MB); smaller textures need new GLB files and their provenance.

The high tier does not change: `isPbrLite()` is false there (tested), the tree, mural and ground options default to the old values, and the governor ladder of the high tier is the same list as before (tested).

## Before and after

Median frame time, ms. "Before" is `?pbrlite=0`.

| Profile | Camera | Toon ms | Pbr before ms | Pbr lite ms | Before / toon | Lite / toon | Draws (toon / before / lite) | Triangles (toon / before / lite) |
|---|---|---|---|---|---|---|---|---|
| iPhone 15 portrait | follow | 148 | 1240 | 675 | 8.4x | **4.6x** | 66 / 80 / 80 | 250,944 / 333,717 / 300,261 |
| iPhone 15 portrait | spawn | 135 | 1186 | 549 | 8.8x | **4.1x** | 77 / 84 / 84 | 240,869 / 234,467 / 209,745 |
| iPhone 15 portrait | krog | 138 | 566 | 480 | 4.1x | **3.5x** | 48 / 55 / 55 | 156,101 / 162,547 / 153,205 |
| iPhone 15 landscape | follow | 154 | 947 | 613 | 6.1x | **4.0x** | 75 / 92 / 92 | 263,667 / 347,010 / 313,884 |
| iPhone 15 landscape | spawn | 134 | 1040 | 541 | 7.8x | **4.0x** | 83 / 90 / 90 | 260,872 / 253,558 / 229,748 |
| iPhone 15 landscape | krog | 172 | 692 | 534 | 4.0x | **3.1x** | 55 / 62 / 62 | 175,775 / 213,135 / 200,843 |
| Pixel 7 portrait | follow | 155 | 1604 | 864 | 10.3x | **5.6x** | 65 / 79 / 82 | 249,892 / 333,055 / 269,955 |
| Pixel 7 portrait | spawn | 141 | 1436 | 716 | 10.2x | **5.1x** | 77 / 84 / 84 | 240,613 / 231,285 / 206,389 |
| Pixel 7 portrait | krog | 170 | 820 | 595 | 4.8x | **3.5x** | 47 / 54 / 54 | 152,654 / 159,268 / 149,758 |
| 360x640 | follow | 140 | 1162 | 677 | 8.3x | **4.8x** | 66 / 81 / 81 | 250,764 / 306,302 / 272,666 |
| 360x640 | spawn | 131 | 1076 | 516 | 8.2x | **3.9x** | 77 / 84 / 84 | 240,813 / 234,405 / 209,689 |
| 360x640 | krog | 136 | 562 | 417 | 4.1x | **3.1x** | 47 / 54 / 54 | 152,942 / 159,382 / 150,046 |

- By view, pbr / toon, before to after: `follow` 6.1x to 10.3x to 4.0x to 5.6x; `spawn` 7.8x to 10.2x to 3.9x to 5.1x; `krog` 4.0x to 4.8x to 3.1x to 3.5x. Over all 12 rows: before 4.0x to 10.3x, pbr lite 3.1x to 5.6x.
- The street view (`krog`) gains the least: what is left there is the standard material on the ground and the walls, which is the look itself.
- Download (every profile, the bytes on the wire after the late loads): toon 7.49 MB and 134 requests, pbr before 15.77 MB and 213, pbr lite 14.16 MB and 207. Pbr lite is 1.89 times toon (before: 2.11).
- Texture memory (the estimate): toon 241 MB, pbr before 345 to 352 MB, pbr lite 329 to 337 MB.
- The governor's pixel ratio rungs, for scale: pbr lite at pixel ratio 1 (iPhone 15 portrait) is 353 ms at `spawn` and 291 ms at `krog` (toon at pixel ratio 1: 119 and 99 ms). `pixel-ratio-1.json`; this run was before the ground cut.
- JSON: `profiles-fixed.json`. Load average during the runs: 2.2 to 5.2 (SwiftShader uses the 4 CPUs).

Screenshots, the same camera, toon (phone tier), full pbr (high tier) and pbr lite (phone tier), iPhone 15 portrait, from `e2e/pbr-lite.spec.js`:

- `spawn-toon-full-lite.jpg`
- `krog-toon-full-lite.jpg`
- Full size: `e2e/__screenshots__/pbr-lite-<camera>-<look>.jpg`.

The headless high tier can draw the procedural trees with the full leaf cards when the Blender tree GLBs miss their 15 s limit on the dev server (see `docs/perf/191/leaf-cards.md`).

## The budget

`docs/perf/budget.json`, `phone/pbr` (checked by `npm run perf:check`, the 15 s trail ride at 1280 x 720):

| Metric | Pbr lite (2 runs) | Toon (same pass) | Cap | Ratio to toon | Ratio cap (`vsToon`) |
|---|---|---|---|---|---|
| Draw calls | 112, 112 | 95, 94 | 125 | 1.18x, 1.19x | 1.3x |
| Triangles | 318,213, 331,045 | 310,321, 309,591 | 350,000 | 1.03x, 1.07x | 1.15x |
| Texture memory (estimate, MB) | 341.8, 340.5 | 241.2 | 360 | 1.42x, 1.41x | 1.5x |
| Download (MB, to the end of the ride) | 12.22, 12.22 | 5.55 | 13.5 | 2.2x | 2.35x |
| Textures (count) | 201 | 92 | 225 | | |
| Geometries | 141 | 113 | 160 | | |
| Download before the first frame (MB) | 3.92 | 4.05 | 4.3 (not changed) | | |

- The ratio caps are new (`checkBudget()` in `scripts/perf-lib.mjs`, tested): a `vsToon` block compares each metric with the phone/toon run of the same pass, and fails when there is no toon run. So `perf:check` must run both looks (its default).
- Old caps of `phone/pbr`: triangles 420,000, download 16.5 MB, textures 375, geometries 197, and the tier's 185 calls.
- Proof that a regression fails: the same check with `--extra "&pbrlite=0"` (the old phone pbr) exits 1: triangles 373,539 over 350,000 and 1.2x over 1.15x, download 13.83 MB over 13.5 and 2.49x over 2.35x.
- The download ratio is 2.2x in this ride and 1.89x in the profile runs above: the perf ride counts the bytes up to the end of its 15 s ride (toon 5.55 MB), the profile runs wait for every late load (toon 7.49 MB).
- The pbr ride stops at the 150 s wall-time limit (180 frames), so its draw calls and triangles come from where it stopped. Frame time has no cap (SwiftShader). On this ride the mean frame was 815 ms for pbr lite and 172 ms for toon (4.7x; #191 measured 10.8x for the old phone pbr on another machine).

## The governor step to toon

- `src/render/governor.js`: the pbr lite ladder is pixel ratio 1.5, 1.25, 1 (each with the grade pass; with no post pass the pbr scene draws into the MSAA canvas, which costs more, #195), then the toon look. The budget is the same as before: a median frame over 25 ms steps down.
- `LITE_GOVERNOR`: a measurement ends after 90 frames or after 4 s with 8 frames or more; 4 frames in a row over 250 ms count as a slow phone, not as a pause (a single long frame is still ignored); and a step skips the pixel ratio rungs that cannot reach the budget even if the whole frame were pixels (80 ms at 1.5 goes straight to toon). The other tiers and looks keep the old governor.
- The look builds the scene, so the step is a reload (`src/render/look-down.js`): a saved "pbr" choice becomes "toon" (so the next visit starts in toon), a `?look=pbr` flag becomes `?look=toon`, and the next page shows one HUD line for 8 s: "Switched to the toon look to keep the game smooth." The player can pick PBR again in the settings menu. The run starts again at the spawn after the step: that is the cost of a reload.
- `?lookdown=0` leaves the toon step out. `?governor=0` turns the governor off. `?govbudget=<ms>` sets the budget.
- Tests: `src/render/governor.test.js` (the ladder, the steps, the skip, the slow frames, a pause), `src/render/look-down.test.js`, and `e2e/pbr-lite.spec.js` (the step in a real browser: pbr lite with a 1 ms budget reloads into toon, shows the line once, and a refresh does not show it again; a saved pbr choice becomes toon; a 100 s budget keeps pbr lite). `notice-and-readout.jpg` shows the line and the readout.

## Open: the check on a real phone

The acceptance of #246 needs the frame time on a real mid-range phone under the #24 target. This machine has no GPU and no phone, so that is NOT verified. The phone target (`docs/perf/baseline.md`): mean 16.7 ms, p95 20 ms on a mid-range phone (Pixel 6a, Galaxy A54 class).

Steps (about 2 minutes per look):

1. Deploy this branch (the Vercel preview of the PR) or serve `npm run build && npm run preview -- --host` on the same Wi-Fi.
2. On the phone (Chrome on Android, Safari on an iPhone), close other tabs, plug in or have over 50 % battery, low power mode off.
3. Open `<site>/?look=pbr&fps=1&governor=0`. A phone gets the phone tier by itself. Check the last line of the readout: `pbr lite · phone · x1.5`.
4. Skate the trail from the spawn toward Ponce City Market for 2 minutes. The readout (left side, mid height) shows the median and the p95 of the last 2 minutes; it reads "2 min" when the window is full. Write down the median and the p95.
5. Open `<site>/?look=toon&fps=1&governor=0` and do the same ride. Write down the numbers.
6. Open `<site>/?look=pbr&fps=1` (the governor on) and ride for 1 minute. Write down the rung and the pixel ratio at the end, or that the game went to toon with the line.
7. Pass: the pbr lite median in step 4 is 16.7 ms or less and the p95 is 20 ms or less (the #24 target), or the governor in step 6 holds a pbr rung at 25 ms or less. Fail: the game goes to toon in step 6 on a mid-range phone. Then pbr lite needs more cuts (the next candidates: pixel ratio 1.25 as the start, 512 px people textures, no leaf cards).
8. Put the phone model, the browser and the numbers in #246.

Also open: `npm run perf -- --gpu` on a laptop for the high tier (#157, #191), unchanged by this work.
