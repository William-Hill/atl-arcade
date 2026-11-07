# #191 The pbr look's shading cost

Headless Chromium with SwiftShader (a software GPU on the CPU, 4 CPUs), 1280 x 720 at pixel ratio 1, 2026-11-07. Every number here is relative: compare two runs of the same machine, not a phone. No run on a real GPU or a phone yet (see "Still open").

`before` is `epic/city-look` at e890ea4 (the base of this branch). `after` is this branch.

## The ride: toon / pbr ratio per tier

`npm run perf` (the 15 s trail ride, `?perf=1&governor=0&run=free&npcseed=1`), one run per row, both builds on the same machine one after the other. JSON: `before.json`, `after.json`.

| Tier | toon mean ms (before / after) | pbr mean ms (before / after) | pbr / toon before | pbr / toon after |
|---|---|---|---|---|
| low | 279 / 259 | 3665 / 2431 | 13.2x | **9.4x** |
| phone | 188 / 190 | 2871 / 2044 | 15.3x | **10.8x** |
| high | 3449 / 3580 | 8607 / 9380 | 2.5x | 2.6x |

- The pbr rides stop at the 150 s wall-time limit with 37 to 66 frames on low and phone, and 11 to 14 on high, so their means are rough. The high rows are inside the noise: the changes below are mostly for the phone and low tiers, and high is not faster.
- The 2026-11-06 baseline (`docs/perf/baseline.md`, another session on another machine) gave 8.8x on low and 12x on phone. A run on another machine does not compare with these: the same `before` build gave 13.2x and 15.3x here.
- Draw calls, triangles, textures, geometries, heap and downloads stay under `docs/perf/budget.json`. `budget.json` does not change.

## A fixed camera: where the pbr frame goes

The ride moves, so for the split the frame time was read at one fixed camera on the trail by the spawn (`cam=312,2,-175,334,3,-80`, `view=fixed&npcs=0&cars=0&wind=0`, the 13:30 sun). Each value is the median of 7 frames, rAF to rAF with a 1-pixel `readPixels` so the software GPU finishes each frame.

Phone tier, `before` build, one part off at a time:

| Change | pbr frame ms |
|---|---|
| none | 3409 |
| `?heightfog=0` | 3371 |
| `?pbrgrade=0` | 3299 |
| `?landmarkglb=0` | 3298 |
| env map off (`scene.environment = null`) | 2286 |
| `?trees=kit` (no leaf cards) | 1158 |
| toon, for scale | 150 |

The same frame with one kind of object drawn at a time: the prop batch (`props`: the trees with their leaf cards, the lamps, the benches) 2341 ms, the ground tiles (`surface`) 931 ms, everything else under 260 ms each. Toon: props 96 ms, ground 89 ms.

So the cost was not the height fog, the grade or the landmark materials. It was:

1. **The leaf cards** (only the pbr look has them, on every tier). A crown is many card layers, each cut with `discard`, so every layer runs the whole lit shader and the procedural leaf cut. The leaf cut loop alone was about 0.7 s of the 3.4 s.
2. **The env map lookup** (`textureCubeUV`, two per pixel in every standard material, and every leaf layer): about 1.1 s.
3. **The pbr ground**: 8x anisotropic filtering on three texture-array samples over most of the screen: about 0.5 s of its 0.97 s.

## What changed

| Change | Tiers | Ground or frame, before → after | Look |
|---|---|---|---|
| Ground arrays at 2x anisotropy, not 8x (`GROUND_ANISOTROPY`, `src/render/pbr-ground.js`) | phone, low (high keeps 8x) | ground alone 1048 → 668 ms (4x: 893) | no visible change at skating height |
| Leaf cut: a card that is one clump skips the leaf loop; a leaf out of reach of the pixel skips its turn and shape (`src/render/leaf-cut.js`) | all | frame 3.5 → 3.1 s (with the line above) | same leaf places; high frame: 0.08 % of pixels differ by more than 16/255 |
| Sky SH: the env lookups read 9 spherical harmonics of the same sky (`installSkySh()`, `src/render/pbr-look.js`; `skyShFromScene()`, `src/render/look.js`). `?skysh=0` keeps the map | phone, low (no clouds) | frame 2885 → 2213 ms | luma p2/p50/p98 6/124/235 → 6/125/236 on phone, 7/125/235 → 7/126/236 on low |

At the fixed camera, before → after: phone 3409 → 2213 ms (toon 150), low 4246 → 3063 ms.

Before (top) and after (bottom), same camera: `phone-before-after.jpg`, `low-before-after.jpg`, `high-before-after.jpg` (people walk between the two shots).

## Tried and dropped

- **A depth pre-pass for the props** (draw the depth with the leaf cut first, then the lit pass with depth test EQUAL and no `discard`, so each pixel is lit once): the phone frame went from 3.4 s to 4.4 s on SwiftShader. The pre-pass runs the leaf cut on every layer too, and the lit pass did not get cheaper. Not kept. It may still pay on a real GPU (early depth test); untested.
- **A cheaper leaf hash** (no `sin` per leaf, golden-angle turns): faster, but it moved the leaves and the near crowns read as big flat shards. Not kept.
- **No leaf cards on phone and low** (`?trees=kit`): the frame drops to 1.16 s, but the trees become the low-poly kit trees. The art direction tier table keeps leaf cards out of phone and low only as a target ("drop (impostors)"); that is a look decision, left for the owner.

## Still open

- **A real GPU and a phone.** `npm run perf -- --gpu` on a laptop (high tier, pbr against toon) and a run on a mid-range phone (Pixel 6a, Galaxy A54 class) with `?look=pbr&quality=phone`. Not possible in the cloud machine. #191 and the last items of #157 (FPS over 55 on high, the phone-tier decision) stay open until then.
- On SwiftShader the pbr frame is still about 10x the toon frame on phone and low. The largest cost left is the leaf cards (see above).
