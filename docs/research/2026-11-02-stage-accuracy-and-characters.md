# Research: stage accuracy, the road to PS4 graphics, and rigged characters

- Date: 2026-11-02
- Asked by: William
- Scope: the `beltline-eastside` level, the render code in `src/render/`, the img2threejs skill, and open 3D models from the X likes of @emjay_hill.
- Code state that this report reads: branch `claude/m2-facade-kit` (PR #47, which includes PR #46). The terrain data comes from the local worktree of branch `claude/m2-terrain`. That branch is not on GitHub yet, so its numbers can change.
- This report changes no game code.

## Summary

1. **The stage is real in plan, but not in height or grade.** The streets, the trail, and the footprints come from OpenStreetMap, so their positions are correct. The two errors that a local sees first are these:
   - The trail is flat. In the real place, the trail crosses Ponce de Leon Avenue, North Avenue, and Ralph McGill Boulevard on bridges, and it goes under Freedom Parkway and Highland Avenue.
   - About 1 in 10 houses is 3 to 5 times too tall. 51 houses are taller than 20 m. Two 18- and 21-story towers next to Ponce City Market are only 20 m and 28 m high.
2. **Graphics.** Stay on `WebGLRenderer` now. Do these steps first: compress the textures (KTX2), improve the toon shading, add instanced trees, and bake the light. Move to WebGPU later, as a test behind a flag. Do not use Google Photorealistic 3D Tiles. Its terms block caching and derived colliders, and its photos show real streets as they are.
3. **img2threejs.** It can build a skinned body in code (`THREE.SkinnedMesh`, 49 bones). It cannot rig a face. It writes no morph targets, no face bones, no visemes, and no GLB. Nia has 65 Mixamo joints, 24 clips, and 0 face controls. Her face uses decals (PR #38).
4. **X likes.** One liked collection is usable: the Scenario 3D collection on Hugging Face (1,342 models, 1,271 GLB, CC BY 4.0). The liked `plugin-character` (img2character) rigs a body, but not a face. A liked MetaHuman blendshape tool has no public code.

## Part 1: how real is the stage?

### What the level has

| Item | Value | Source |
|---|---|---|
| Box | 970 m east to west, 1946 m north to south (33.7560 to 33.7735 N, -84.3685 to -84.3580 W) | `raw/fetch.json` |
| Buildings | 1045 | `level.json` `stats` |
| Height source | 6 OSM `height`, 15 OSM `building:levels`, 912 Overture, 112 type defaults | `level.json` `stats.buildingHeights` |
| Street, sidewalk, path, and trail strips | 489, 329, 175, 13 | `level.json` `stats.strips` |
| Street names | 79 | `level.json` `strips[].name` |
| Trail | 13 OSM ways, 2327 m of strip, 4.3 m wide | `level.json`, `TRAIL_WIDTH` in `scripts/build-block.mjs` |
| Parks | 12 areas | `level.json` `areas` |
| Terrain | Flat (y = 0) on PR #47. An 8 m USGS 3DEP grid on the terrain branch | `raw/terrain.json` (terrain branch) |

### Method

1. I read `level.json`, `raw/overpass.json`, and `raw/overture.json` with Node scripts.
2. I found the road crossings of the trail from the OSM `bridge` and `layer` tags.
3. I decoded the terrain grid on the terrain branch and sampled it along the trail.
4. I sent one count query to the Overpass API for the features that the build script does not fetch: trees, water, art, skateparks, building parts, and railways.
5. I compared the heights of known buildings with story counts from the press. A story count is not a height. Where I give an estimate, I use the rule of the build script: `levels × 3.2 + 1` m.

### Errors and gaps, ranked by how much a local player sees them

**1. The trail is flat, but the real trail has 3 bridges and 2 underpasses.** OSM tags these crossings:

| Crossing (lat, lon) | Real layout (OSM tags) | Level now |
|---|---|---|
| Ponce de Leon Avenue (33.77336, -84.36460) | The trail is on a bridge (way 83291379, `layer=2`) | Both at grade |
| North Avenue (33.77114, -84.36385) | The trail is on a bridge (ways 83294497 and 741961708, `layer=1`) | Both at grade |
| Ralph McGill Boulevard (33.76747, -84.36081) | The trail is on a bridge (way 83291376, `layer=2`) | Both at grade |
| John Lewis Freedom Parkway (33.76442, -84.35962) | The road is on a bridge over the trail (`layer=1`) | Both at grade |
| Highland Avenue (33.76144, -84.36148) | The road is on a bridge over the trail (`layer=1`) | Both at grade |
| Irwin Street (33.75754, -84.36490) | At grade, with a raised table | At grade (correct) |

The terrain branch adds the ground. Numbers from its 8 m grid (fetched 2026-11-03 00:18 UTC):

- The relief in the box is 50.43 m (270.09 m to 320.52 m above sea level).
- Along the trail, the ground is between 275.8 m and 305.6 m.
- With bilinear samples every 16 m, the trail grade reaches 54.6 %. The 6 steepest samples are all at the North Avenue bridge (ways 741961708, 83291378, 741961710, 83294499, 741961707, 741961709). The 3DEP DEM is bare earth, so it removes the bridge deck and shows the road below.
- An earlier 4 m grid from the same branch gave the same result: a peak of 52.9 % at the bridges.

Result: the DEM alone puts a ditch at each bridge. Each bridge needs a deck at the trail grade, with the road below it. I did not read the terrain branch code for the bridges, so I do not know if it does this now.

**2. Overture makes 51 houses taller than 20 m.**

- The level has 730 buildings of type `house`, `detached`, or `semidetached_house`.
- 71 of them are taller than 15 m, and 51 are taller than 20 m. The tallest is 37.1 m (way 269991883). All 71 heights come from Overture.
- The median Overture height for a house is 6.7 m, which is correct for a 1- or 2-story house.
- The bad heights are in two groups: north of Freedom Park (about z -500 to -900) and in Inman Park (about z 350 to 730).
- A local sees an 8- to 12-story bungalow at once.
- Fix: cap the Overture height by the OSM type, for example 12 m for a house, and log each cap.

**3. The towers next to Ponce City Market are too short, and one store is too tall.**

| Building (OSM id) | Level height | Real | Error |
|---|---|---|---|
| Signal House (w269992060) | 27.7 m (Overture) | 21 stories ([BD+C](https://www.bdcnetwork.com/home/news/55165570/atlantas-old-fourth-ward-gets-a-21-story-162-unit-multifamily-residential-building)) | About -40 m against an estimate of 68 m |
| Overline Residences (w1139043886) | 19.73 m (Overture) | 18 stories ([Atlanta Agent Magazine](https://atlantaagentmagazine.com/2023/09/28/overline-residences-opens/)) | About -38 m against an estimate of 59 m |
| 725 Ponce (w741961703) | 39.4 m (12 OSM levels × 3.2 + 1) | 12 stories ([Wikipedia](https://en.wikipedia.org/wiki/725_Ponce)) | Probably low, because office floors are often higher than 3.2 m. Not verified |
| Kroger at 725 Ponce (w741961704) | 51.5 m (Overture) | A ground-floor store under the 12-story building ([Wikipedia](https://en.wikipedia.org/wiki/725_Ponce)) | The store footprint is 12 m taller than the office tower. This is wrong |
| 619 Ponce (w1139043884) | 23.57 m (Overture) | 4 stories ([ULI](https://casestudies.uli.org/metro_area/atlanta)) | About +6 m against an estimate of 17.8 m |
| Ponce City Market (w184803195) | 50 m (OSM `height`), one block | 10 OSM levels and a taller center tower | The whole 17,681 m² footprint is one 50 m box. The real tower height is not verified. PR #44 adds a hand-made tower |
| Fourth Ward Offices Tower One and Two (w1139043888, w1139043887) | 23.16 m and 10.9 m | Not verified | The twin names suggest a similar height. One value is probably wrong |

These buildings make the skyline that a player sees from the trail. Fix: put a `heights.json` override file in the level folder, with a source URL for each value, and read it before OSM and Overture.

**4. The Historic Fourth Ward Park lake and skatepark are missing.** The Overpass query in `build-block.mjs` fetches only buildings, highways, parks, and grass. OSM has more in the box:

- `natural=water`: 4 ways, for example way 33228143 (a pond at 297 m) and way 182470309 (a retention basin). The level has no water.
- The Historic Fourth Ward Skatepark: way 182470291 (`leisure=pitch`, `sport=skateboard`, concrete) at 33.76472, -84.36039. A skate game with no skatepark at the real skatepark is a large gap.
- `building:part`: 2 ways. The level does not use them.

**5. No tree canopy.** OSM has 0 `natural=tree` nodes and 0 wood or forest areas in the box. The props place trees by rule. The real Eastside Trail has a dense canopy. A canopy source is necessary, for example an open canopy layer from the City of Atlanta. I did not check which canopy layers are open.

**6. Art on the trail.** OSM has 12 `tourism=artwork` points in the box. Examples: "The Bridge" (a sculpture), "33 Oaks" and "Northern White" (David Landis), "Convergence" (Kevin Chambers), and two murals. The AGENTS.md rule applies: use a mural only with the permission of the artist. The sculptures are good positions for permitted art props or for "Art on the BeltLine" fact cards.

**7. Small data defects.**

- Two park rings are in the level twice. Freedom Park is in the file as `leisure=park` and as `landuse=grass` with the same outline (areas of 143,589 m² and 100,506 m²). Two equal faces can flicker (z-fighting).
- Street widths are defaults by class. The level has 11 width values (3 m to 19.8 m). I did not compare them with real curb widths.
- Two trail ways keep an old `construction=cycleway` tag (742982445, 1043756762). The build script includes them, which is correct, because the trail there is open.
- 112 buildings use a type default height, for example Stove Works at 6 m (w211061297). Not verified against the real building.

**8. What is correct.**

- The street positions, the 79 street names, and the 95 sign positions at real intersections come from OSM. I did not measure the offset between OSM and the imagery.
- The footprints of all 1045 buildings come from OSM, and they include the named lofts and landmarks: Ponce City Market, Krog Street Market, Studioplex, Telephone Factory Lofts, Ford Factory Lofts, New Realm Brewing, 755 North, and more.
- Freedom Park, the Historic Fourth Ward Park, and the Atlanta Art Park are in the level as park areas.

**9. Edge of the box.** The box ends at 33.756 N. The Krog Street Tunnel is south of this line, so it is not in the level. I did not measure its exact position.

### Not verified in Part 1

- I did not compare the footprints with aerial photos.
- The real heights of Ponce City Market, Telephone Factory Lofts, Iris O4W, and the Fourth Ward Offices are not verified.
- The story-count estimates use 3.2 m per floor. Real floors can be higher.
- I did not run the game. I read only the data files.

## Part 2: the road to "Stylized high-end"

### The render now

- `src/render/geo-view.js`: `MeshToonMaterial` with `onBeforeCompile` for the facades and the surfaces.
- `src/render/post.js`: `EffectComposer`, MSAA ×4, `GTAOPass`, a depth and normal ink pass, and `UnrealBloomPass`.
- `src/render/quality.js`: the low tier has no post effects and no shadows, and the far plane is 320 m.
- three.js 0.186.1 in the repository. r187 came out on 2026-10-30, so the 7-day rule blocks it until 2026-11-06.

### Findings

| Technology | Status | Fit for Skate ATL |
|---|---|---|
| `WebGPURenderer` + TSL | Falls back to WebGL 2. It does not support `ShaderMaterial` or `onBeforeCompile` ([docs](https://threejs.org/docs/pages/WebGPURenderer.html)). r187 has TSL nodes for TRAA, SMAA, FXAA, GTAO, SSR, bloom, and outlines ([r187](https://github.com/mrdoob/three.js/releases/tag/r187)) | Later. The facade shaders need a rewrite in TSL. A forum test on r183 shows about 2 times the CPU cost per frame of `WebGLRenderer` on a scene with many meshes ([forum](https://discourse.threejs.org/t/webgpurenderer-2x-slower-cpu-and-5-10x-slower-first-frame-than-webglrenderer-on-many-mesh-scenes-r183-same-on-both-backends/91904)). Not verified on this game |
| Browser support for WebGPU | Chrome and Edge on Mac, Windows, and ChromeOS. Safari 26. Firefox 141+ on Windows ([gpuweb](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status)) | Keep a WebGL path. WebGPU on SwiftShader is not verified |
| KTX2 (Basis) + meshopt | gltf-transform and KTX-Software (Apache-2.0) | Yes, now. A smaller download and less GPU memory |
| TAA / TRAA | TRAA needs a WebGPU velocity buffer. The WebGL `TAAPass` suits a still camera only | Later, with WebGPU. Use FXAA or SMAA after the ink pass now |
| Instanced trees, LOD, impostors | `InstancedMesh`, `BatchedMesh`, `@three.ez/instanced-mesh` (BVH culling and LOD), `octahedral-impostor` (license not verified) | Yes. The largest visual gain after the heights |
| Baked light | `LightProbeGridWebGL` works with `WebGLRenderer`. `LightMapper` (r187) needs WebGPU. A Blender bake costs 0 ms at run time | Yes. It is the best gain for the low tier |
| Gaussian splats | Spark (MIT, WebGL 2). GaussianSplats3D (MIT, no longer in development) | No. Splats look like photos, which does not match the toon look. A scan also captures people and cars |
| Google Photorealistic 3D Tiles | The terms say "you must not pre-fetch, index, store, or cache any Content" ([policies](https://developers.google.com/maps/documentation/tile/policies)). Derived objects are not permitted. $6.00 per 1,000 root requests after the free cap | No. It also shows real cars and real street conditions, which conflicts with the political rules |
| 3DTilesRendererJS | Apache-2.0 | Only if a tile source with open terms appears |

### Next steps, ranked

The costs in days and the frame costs in ms are estimates for a mid GPU at 1080p. No source gives them. Measure each step with the 55 FPS gate.

| # | Step | Cost | Visual effect | Frame risk | Low tier |
|---|---|---|---|---|---|
| 1 | Fix the heights (Part 1, items 2 and 3): cap the houses, add `heights.json` | 1 day | High: the skyline | 0 ms | Yes |
| 2 | Bridge decks and underpasses on the terrain (Part 1, item 1) | 2 to 3 days | High: the trail reads as the real place | Under 0.2 ms | Yes |
| 3 | KTX2 + meshopt for all textures and GLBs | 1 to 2 days | Indirect: room for more scans | About 0 ms | Yes |
| 4 | Toon pass: a ramp per material, a rim light, a halftone band in the shadow, and an inverted hull on the skater | 2 to 3 days | High: the Jet Set Radio look | Under 0.5 ms | Ramp and rim: yes |
| 5 | Instanced trees with leaf cards and wind in 3 sizes, LOD, and impostors past 100 m | 4 to 6 days | High: "the city in a forest" | 1 to 3 ms | Fewer trees, impostors only |
| 6 | Baked AO and light (Blender bake to vertex color or lightmap) plus `LightProbeGridWebGL` | 3 to 5 days | Medium to high | Saves 1 to 2 ms of GTAO | Yes |
| 7 | FXAA or SMAA after the ink pass, and remove MSAA ×4 | 1 day | Medium: clean ink lines | 0.4 to 1.3 ms | Off, or FXAA after a check |
| 8 | Water and the skatepark in Historic Fourth Ward Park | 2 days | Medium | Under 0.5 ms | Yes |
| 9 | `WebGPURenderer` test behind `?renderer=webgpu`: port the facade shaders to TSL, and the post chain to `RenderPipeline` | 8 to 15 days | Medium: TRAA, SSR, compute | About 2 times the CPU per draw call | Keep `WebGLRenderer` until the WebGL 2 backend passes 55 FPS on SwiftShader |
| 10 | Gaussian splats and Google 3D Tiles | n/a | n/a | n/a | Do not do |

### Not verified in Part 2

- No step was run or measured in this game.
- The ms costs and the days are estimates.
- WebGPU on SwiftShader and the KTX2 formats that SwiftShader supports are not verified.
- I could not read the full Google Maps Platform terms. The page does not say if restyled (cel-shaded) tiles are permitted.

## Part 3: can img2threejs make a rigged character with a face rig?

Skill: `~/.claude/skills/img2threejs`, HEAD a669e9a (2026-09-05).

### Verdict

| Capability | Answer | Evidence |
|---|---|---|
| Skinned, animatable body | Partly. It builds a `THREE.SkinnedMesh` with one `Skeleton` in a TypeScript factory, from primitive shapes. It writes no animation clips and no GLB | Run below. `forge/stage3_build/generate_threejs_factory.py:1932-1940` (`emit_rig_hierarchy`) |
| Face bones (jaw, eyes, lids) | No | `forge/stage2_spec/new_sculpt_spec.py:909` (`derive_character_rig`) makes a bone only for a part with an `attachment` (lines 944-945). The eyes, brows, nose, and mouth are children of `head`, with no bone |
| Morph targets (blendshapes) | No. One helper calculates morph deltas, but no emitter calls it | `forge/stage3_build/morph_targets.py:35-100`. `grep morphAttributes forge` finds no emitter |
| Visemes, ARKit 52 names | No | `grep -ri "arkit\|viseme"` in the skill finds 0 hits |
| Eye and jaw controls | No | No face bones and no morph targets |
| Animation | No clips. `forge/stage5_rig/emit_animation_runtime.py:1-8` wraps clips that exist already | Read only |
| `animated-character` profile | Not installed | `state.py init --profile animated-character` fails: "invalid choice… (choose from generic, character)". `CHANGELOG.md:15-16` and `SKILL.md:77,81,303` say that the profile needs the plugin-character |

**The public `plugin-character` (also called img2character).** The author announced the split on 2026-10-24 ([@NickDevFE](https://x.com/NickDevFE/status/2113993918874337628)). The repository is [img2threejs/plugin-character](https://github.com/img2threejs/plugin-character): Apache-2.0, created 2026-08-27, last push 2026-10-10. It is not installed here. I read its source, but I did not run it.

- It adds a body rig: a skeleton from a GLB, skin weights, clip measurement, and a 12-check rig gate (`README.md`, `tools/rig_*.py`, `tools/anim_*.py`, `tools/gate_rigging.py`).
- It has no face rig. A grep for "morph", "blendshape", "viseme", "arkit", "jaw", and "facial" finds hits in one file only. There, `tools/rig_glb_reference.py:1411-1412` says that morph `weights` channels "are not evaluated at all".
- So the plugin can rig the body of a GLB, as Mixamo does for Nia now. It does not add a face.

The docs plan more: `ROADMAP.md:217` (G1) lists "SkinnedMesh + Bones + Morph targets" for facial expression as deferred to v2.3. `ROADMAP.md:218` (G2) lists glTF export and `AnimationMixer` as deferred to v2.2. `ROADMAP.md:217` also lists SkinnedMesh as deferred, but `CHANGELOG.md:194-197` (v1.5) and the code show that the SkinnedMesh emitter exists. The code is correct, and that roadmap line is out of date.

### Run (offline, no cost)

```
python3 forge/stage2_spec/new_sculpt_spec.py "Test Skater" --character --out spec.json
python3 forge/stage3_build/generate_threejs_factory.py spec.json --out factory.ts --allow-nonstrict
python3 forge/stage3_build/morph_targets.py base.json --target t.json
```

- The spec has 61 components and 49 bones: pelvis, spine, clavicles, arms, 30 finger bones, legs, neck, and head. It has no jaw or eye bones.
- The factory (530,860 bytes) has 53 `SkinnedMesh`, 49 `new THREE.Bone`, 1 `new THREE.Skeleton`, 0 "morph", 0 "jaw", and 0 `AnimationMixer`.
- `morph_targets.py` printed "jawOpen: 1 moved, max displacement 0.2". It works only as a standalone calculator.
- `--allow-nonstrict` skips the quality gate, so this run is not a production pass.

### Comparison with the current pipeline

| | Nia (Tripo + Mixamo rig) | img2threejs |
|---|---|---|
| Output | `assets/skaters/nia/skater.glb`, 2,735,736 bytes, Draco | A TypeScript factory, no GLB |
| Body rig | 1 skin, 65 `mixamorig:` joints | 1 skeleton, 49 bones |
| Clips | 24 (idle, push, grinds, airs, 8 dances, and more) | 0 |
| Face | 0 face joints, 0 morph targets. Blinks and expressions are shader decals (PR #38: `src/render/skater-face.js`, `src/render/face-anim.js`) | 0 face bones, 0 morph targets |
| Look | A sculpted mesh from concept art | A figure from primitive shapes |

### The gap to an ARKit-style face

- An ARKit face has 52 blendshapes, for example `eyeBlinkLeft`, `jawOpen`, `mouthSmileLeft`, and `browInnerUp`. A common viseme set has 15 shapes (sil, PP, FF, TH, DD, kk, CH, SS, nn, RR, aa, E, I, O, U). Nia has 0 of them.
- The cause is the mesh. The Tripo mesh is one surface with a painted face. It has no edge loops at the lids or the lips, no eyeballs, and no mouth. A morph target needs this geometry first.
- img2threejs cannot close this gap.
- The decal face on PR #38 is enough for a toon game with no dialog. Jet Set Radio characters do not lip-sync.
- If the game needs speech later, these options exist. None of them is verified for this project:
  1. Retopologize the head in Blender, add eyes and a mouth, and sculpt the 52 shape keys. Export them as glTF morph targets.
  2. Use a rigging tool that makes ARKit blendshapes. Check the license and the 7-day rule first.

## Open 3D models from the X likes

Method: I read the likes of @emjay_hill in Chrome. The page loaded 149 liked posts, dated 2026-10-15 to 2026-10-26. 69 of them match 3D words. Likes newer than 2026-10-26 did not load, so this list does not cover them. The 12 links in `docs/research/2026-11-02-x-links-level-and-assets.md` cover some newer posts.

### Model collections

| Post | What | License | Use in Skate ATL |
|---|---|---|---|
| [@emmanuel_2m](https://x.com/emmanuel_2m/status/2113990638748241966) and [@Scenario_gg](https://x.com/Scenario_gg): [scenario-labs/3d-collection](https://huggingface.co/datasets/scenario-labs/3d-collection) | 1,342 AI-generated examples, about 39 GB: 1,271 GLB, 137 Blender, 41 SPZ, 23 PLY, 21 VOX, 7 FBX. Each example has the prompt and the input image | CC BY 4.0. Credit "Scenario" (dataset card, read through the Hugging Face API). Created 2026-10-19, so it passes the 7-day rule | Yes, with care. Use the metadata file to pick props that match the toon look, and download only those files. Put the credit and the prompt in `provenance.json`. A companion set of 393 Hunyuan examples has other licenses, so do not use it |
| [@doncoderlione](https://x.com/doncoderlione/status/2114277439715098659) | Says that "ThreeJS Assets released 937 free 3D assets" and that NVIDIA gave away free assets | The post has no links. I could not identify either release | Not verified. "ThreeJS Assets" is probably 3dassets.dev (CC0), which the 2026-11-02 X-links report covers already |

### Tools for characters and the face

| Post | What | Use in Skate ATL |
|---|---|---|
| [@NickDevFE](https://x.com/NickDevFE/status/2113993918874337628): img2character | The `plugin-character` (see Part 3) | Body rig only. No face |
| [@hos_giken](https://x.com/hos_giken/status/2114356313706672534) | A tool that makes facial blendshapes from the MetaHuman expression set, in a Blender fork ("Loopcut") | The nearest match to the face-rig question. The post gives no repository or license. Not verified |
| [@Stefan_3D_AI](https://x.com/Stefan_3D_AI/status/2112507522510925933): Prompt2Rig | A text prompt makes a video, GVHMR recovers the motion, and the tool retargets it to a Mixamo rig | Nia has a Mixamo rig, so new clips can come from it. It needs a paid video model on fal. License not verified |
| [@CY160909](https://x.com/CY160909/status/2112574059821346919): Motion2MixamoRig | Video of a real person to a Mixamo animation, exported as GLB | Same use: dance and trick clips from video of real skaters, with their permission. License not verified |
| [@carlosedubarret](https://x.com/carlosedubarret/status/2111396141984256373): CEB SAM 3D Body Loader | A free Blender add-on: video to 3D motion capture | Same use. License not verified |
| [@Stefan_3D_AI](https://x.com/Stefan_3D_AI/status/2114024889644699809): Hi3D 1.0 | An open-source pass that adds sharp geometry to a rough AI mesh. Geometry only | Possible cleanup for landmark meshes. License not verified |
| [@tokufxug](https://x.com/tokufxug): MetaHuman in the browser with WebAssembly and WebGPU | Realistic 3D characters in the browser | No. The MetaHuman license limits the use outside Unreal Engine, and the look is not toon. Not verified |

### Not verified in this section

- I read the post text only. I did not watch the videos.
- I did not download any model or run any tool.
- Only the Scenario license and the `plugin-character` license were read from the source.

## Sources

- OpenStreetMap, ODbL 1.0, through the Overpass API (fetched 2026-11-01 and 2026-11-02).
- Overture Maps Foundation, buildings theme, release 2026-10-21.0.
- USGS 3DEP bare-earth DEM, public domain (terrain branch, fetched 2026-11-03 UTC).
- The web pages linked in each table.
