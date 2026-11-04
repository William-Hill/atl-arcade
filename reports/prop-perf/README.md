# Prop render cost: before and after #89

Date: 2026-11-03. Script: `scripts/prop-perf.mjs`. Data: `low.json`, `phone.json`, `low-no-props.json`.

## Method

- Two production builds: "before" is `origin/main` at `8987934`. "after" is this branch.
- `vite preview` serves each build. Headless Chromium renders with SwiftShader (the playtest harness), 1280 x 720.
- Level: `beltline-eastside`, 3392 props, NPC seed 1. Four fixed cameras: `spawn` (the follow camera at the spawn), `trail-north`, `storefront`, and `overview` (30 m up).
- Each run waits for the props to load and for 30 frames. It then reads `__atl.rendererInfo` and samples the frame times with `__atl.fps` for 6 s.
- 3 runs for each build, camera, and tier. The runs alternate between the two builds. The table gives the median of the 3 runs.
- The load average was 9.3 to 27.1 during the runs. The per-run load is in the JSON files.

## Change

All props are one `THREE.BatchedMesh` (`src/render/prop-batch.js`): one draw call with `WEBGL_multi_draw`. Each prop is one instance. Each prop picks LOD0 (under 60 m), LOD1 (under 200 m), or hidden, by its own distance from the camera. Before, each 50 m tile was one merged mesh per LOD, and the tile center picked the LOD for the whole tile.

## Results: low tier

Draw calls and triangles are exact. The FPS values are the medians of 3 runs.

| Camera | Draw calls before | Draw calls after | Triangles before | Triangles after | p90 frame before (ms) | p90 frame after (ms) | Median FPS before | Median FPS after |
|---|---|---|---|---|---|---|---|---|
| spawn | 56 | 49 | 125,536 | 124,874 | 50.0 | 50.1 | 29.9 | 20.0 |
| trail-north | 17 | 11 | 21,739 | 20,947 | 16.7 | 16.7 | 59.9 | 59.9 |
| storefront | 28 | 13 | 33,482 | 32,190 | 33.4 | 33.4 | 59.9 | 30.0 |
| overview | 59 | 48 | 118,993 | 113,689 | 50.1 | 66.6 | 20.0 | 20.0 |

## Results: phone tier (lite post, ink outlines)

| Camera | Draw calls before | Draw calls after | Triangles before | Triangles after | p90 frame before (ms) | p90 frame after (ms) | Median FPS before | Median FPS after |
|---|---|---|---|---|---|---|---|---|
| spawn | 57 | 50 | 164,791 | 164,129 | 33.4 | 33.4 | 59.9 | 59.9 |
| trail-north | 18 | 12 | 22,819 | 22,027 | 16.7 | 16.7 | 59.9 | 59.9 |
| storefront | 29 | 14 | 34,562 | 33,270 | 16.8 | 33.3 | 59.9 | 59.9 |
| overview | 60 | 49 | 162,907 | 157,603 | 33.4 | 33.4 | 59.9 | 59.9 |

## The share of the props (low tier, before, `&props=0`)

| Camera | Draw calls with props | Draw calls without props | Triangles with props | Triangles without props |
|---|---|---|---|---|
| spawn | 56 | 48 | 125,536 | 116,816 |
| overview | 59 | 47 | 118,993 | 110,881 |

## Verdict

- Draw calls: the props now take 1 draw call. Before, they took 7 to 16. The total decreases by 6 to 15 calls (12% to 54%) on both tiers.
- Triangles: the prop triangles decrease from 8,720 to 8,058 (8%) at `spawn`, and from 8,112 to 2,808 (65%) at `overview`. The total triangles decrease by 0.4% to 4.5%.
- 90th percentile frame time: **not verified**. The change does not show in the FPS samples. The frame times lock to multiples of the 16.7 ms vsync, and the run-to-run spread (for example 50, 50, and 100.1 ms for the same build) is larger than the effect.
- The props are a small part of the frame: without the props, the spawn view still draws 48 calls and 116,816 triangles. The 90th percentile frame time on this harness comes from the buildings, the surfaces, and the fill rate of the software renderer, not from the props.
- Median FPS of 55 or more: true on the phone tier for all cameras, before and after. On the low tier it is false at `spawn` and `overview` for both builds at this load. Thus the FPS gate cannot be verified on this machine at load averages of 9 to 27.

## Look

The screenshots in this folder (`<camera>-<tier>-<build>.jpg`) show the same props before and after. A pixel compare of the first run gives 0.1% to 0.8% changed pixels. The wind, the skater idle, and the NPCs move between the two captures. The ink outlines show on the props on the phone tier.

## Not measured

- The high tier. In headless Chromium (SwiftShader and ANGLE Metal) the high tier page did not answer in 5 minutes, for both builds. On the high tier the props also draw into the shadow map, so the batch removes the same number of calls a second time there.
- A real phone GPU.
