# #191 The leaf card cost on the phone and low tiers

Headless Chromium with SwiftShader (a software GPU on the CPU, 4 CPUs), 1280 x 720 at pixel ratio 1, 2026-11-08. The method of PR #224: a fixed camera, `view=fixed&npcs=0&peds=0&cars=0&wind=0&governor=0&time=14&weather=clear`, `look=pbr`. Each value is the median of 7 frames (5 for the bounds), rAF to rAF with a 1-pixel `readPixels`, so the software GPU completes each frame. Script: `scripts/leaf-perf.mjs`. The numbers are relative: compare two runs of the same machine, not a phone.

`before` is `epic/city-look` at 91640ff (the base of this branch). `after` is this branch.

Cameras (`LEAF_CAMS` in the script): `spawn` is the PR #224 camera on the trail by the spawn (two near Blender crowns fill the top of the frame); `street` is the North Avenue tree row; `park` is the Historic Fourth Ward Park canopy, most crowns far away.

## Before and after

Phone tier, ms per frame. Two runs, before and after one after the other. JSON: `reports/leaf-perf/191-phone.json`.

| Camera | before (run 1 / run 2) | after (run 1 / run 2) | change |
|---|---|---|---|
| spawn | 1948 / 1987 | 1458 / 1453 | **-26 %** |
| street | 1241 / 1155 | 1071 / 1053 | -11 % |
| park | 1286 / 1285 | 1094 / 1152 | -13 % |

Low tier, one run (`reports/leaf-perf/191-low.json`): spawn 2461 → 1898 ms (-23 %), street 1590 → 1360 ms (-14 %).

High tier, one run of 3 frames (`reports/leaf-perf/191-high.json`): spawn 8134 → 8398 ms. High keeps the procedural cut, so the shader is the same; the difference is noise.

For scale, the leaf cards cost (pbr frame minus the frame with `?trees=kit`, no leaf cards) about 1390 ms at spawn, 560 ms on the street and 510 ms in the park. In the bound run below, the baked cut removes 35 % of that at spawn, 40 % on the street and 25 % in the park.

## The options and the bounds

Each option was bounded first with a temporary shader switch (not committed), phone tier, same method, one run:

| Variant | spawn | street | park | What it shows |
|---|---|---|---|---|
| base (procedural cut) | 1967 | 1253 | 1254 | |
| no leaf cards (`?trees=kit`) | 579 | 692 | 743 | the full card cost |
| no leaf loop (every card one clump) | 1334 | 1016 | 1057 | the floor of a baked cut |
| no lighting on the cards | 1946 | 1197 | 1155 | the most a cheaper lit model can give |
| baked cut | 1478 | 1030 | 1126 | (second run, same build) |
| baked cut, half the card layers | 1188 | 899 | 968 | fewer layers |

- **A baked leaf-cut texture: kept.** It gets near its floor (1478 against 1334 ms at spawn). See below.
- **A cheaper lit model for the cards: rejected.** With no lighting at all on the cards, the frame is 20 to 100 ms (2 to 8 %) faster. The phone tier already reads the sky SH (PR #224) and has no shadow map, so the lit model is not where the card cost is. A cheaper model also changes the card color.
- **Fewer card layers: rejected.** Half the layers saves another 13 to 20 %, but the near crowns get holes and look thin (`spawn` in the bake comparison images). That is a silhouette change. A version by distance only can save at most the park part, where the far cards are already one clump and skip the leaf loop.
- **Alpha to coverage: not applicable.** Alpha to coverage needs MSAA. The phone and low tiers have no MSAA (MSAA is part of the high tier post, `quality.js`), so it does not change the cost there. The high tier already uses it (#202).

## What changed

- `bakeLeafCut()` (`src/render/leaf-cut.js`) draws the leaf field of each of the 7 leaf shapes for 8 seeds (variants) per shape, once at load, into a texture array of 56 layers of 128 x 128 px with a mip chain (RG8, 2.45 MB on the GPU, no download). Red is the leaf field, green the leaf tone with the vein.
- The bake runs the same GLSL leaf field as the procedural cut (`leafField()`), on the same GPU. So a variant has the leaf places of the procedural card with the same seed.
- With the `LEAF_BAKED` define, a card pixel reads its layer (the shape and the variant nearest to its seed) with one `textureGrad`, not the loop over its leaves (7 to 16 leaves, three `sin` each). The coverage, the clump change by distance (#202), the edge anti-aliasing and the shade are the same code as before. A card of full leaves also skips the clump shape (one `atan`, two `sin`).
- `leafCutFor()`: phone and low get the baked cut, high keeps the procedural cut. `?leafcut=procedural|baked` sets it for an A/B check. The impostor bake and the shadow pass keep the procedural cut.

## The look

Same views, before (left) and after (right), `spawn` (top) and `park` (bottom): `leaf-cards-phone.jpg`, `leaf-cards-high.jpg`. Full size, `?look=pbr&time=14&weather=clear`, phone and high: `e2e/__screenshots__/leaf-cut-<tier>-<camera>-<before|after>.png` (from `e2e/leaf-cut.spec.js`). The spec also measures the canopy in the top half of the frame: the part of leaf pixels and the mean leaf color must stay within 10 % and 8/255 of the procedural cut.

- The canopy silhouette and color stay. The crowns have the same outline and the same green.
- On SwiftShader the procedural near crowns show as pixel noise. The leaf hash multiplies the seed by about 5 x 10^7 (`sin(seed * 1191) * 43758`), so the small interpolation error of the seed varying moves the leaf from pixel to pixel. The baked cut takes one variant per card, so its leaves are whole, anti-aliased leaves. A real GPU does not show the noise in the procedural cut (an equal varying interpolates to an equal value), so there the two cuts look alike. This is not verified on a real GPU yet.
- The dark speckle of #202 does not come back: the AO pass still skips the cards, and the mip chain filters the veins far away (the procedural cut fades them with `veinOn`).
- The bake takes 119 to 142 ms at load on SwiftShader (`__atl.trees.leafBakeMs`).
- In the high-tier e2e runs the Blender tree GLBs did not load within their 15 s limit on the dev server, so the high shots show the procedural trees (with their leaf cards). High uses the procedural cut in both shots.
- Each card shows one of 8 leaf layouts per shape and not its own layout. The cards also turn at random, so a repeat is hard to see.

## Tests

- Vitest (`src/render/leaf-cut.test.js`): the tier choice, the layer and variant of a leaf code, the 8-bit field (edge shift under a quarter texel), the tone range, the bake layout and bytes, and the `LEAF_BAKED` patch.
- Playwright (`e2e/leaf-cut.spec.js`): 4 of 4 pass. Phone spawn: leaf part 0.574 → 0.570, mean leaf color 98,130,66 → 98,129,67. Phone park, high spawn and high park: no change.
- `npm test`: 1377 of 1379 pass. The 2 failures (`facade-kit.test.js` mural, `geo-mesh.test.js` vertex color) also fail on `epic/city-look` at 91640ff without this change.

## Still open (#191 stays open)

- A real GPU (`npm run perf -- --gpu`) and a phone run (`?look=pbr&quality=phone` on a Pixel 6a or Galaxy A54 class phone). On a real GPU the texture read against the loop can give another ratio. The phone tier still defaults to toon (PR #224).
