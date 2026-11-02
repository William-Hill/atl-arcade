# Research: 12 X links for level quality and free assets

- Date: 2026-11-02
- Asked by: William
- Method: each post was read through the public fxtwitter API. Videos were sampled as 4-frame sheets with ffmpeg. Linked sites, READMEs, and license pages were read directly. The two asset catalogs were searched through their public APIs.
- Scope: what each link gives the BeltLine Eastside level (`levels/beltline-eastside/`), and which free assets the game can use.

## Summary

1. Two free asset catalogs fit the game. Both have a skate park kit with ramps, ledges, rails, and stairs at low triangle counts:
   - 3dassets.dev: CC0 assets. Safe to commit to the repository.
   - Polyfork: free, but you cannot redistribute the files. Polyfork also has rigged skater characters for NPCs (#41).
2. The skate park kits can fill M1-04 (rails, ledges, ramps) faster than code-built kit pieces.
3. Two posts give methods that improve the landmark and surface quality:
   - The PBR texture method in the mukadeshinigami article.
   - The research-first agent pipeline in Construct.
4. Some posts have small value for this game: Mutiny BIM, iCity (Blender only), the Zig engine, and MotionBricks (a 190 MB model).

## Free assets

### 3dassets.dev (https://3dassets.dev)

- What: 22,849 GLB models, web-optimized: quantized geometry, WebP textures, no Draco or KTX2 decoder needed.
- License: CC0 1.0 for new uploads. You can copy, change, redistribute, and sell. Attribution is not required.
  - Exception: "Historical submissions under other licences retain their original terms." Read the `license` field on each asset before use.
  - CC0 does not remove trademark or publicity rights.
- Provenance: most pack assets have `aiGenerated: true`. Example: `aiModel: "Claude Opus 5"` on the skate park pack. Record this in `provenance.json` (AGENTS.md rule).
- Access:
  - MCP: `claude mcp add --transport http 3dassets https://3dassets.dev/mcp`, or over stdio with `npx -y 3dassets-mcp`.
  - REST: `https://3dassets.dev/api/v1/assets?q=...`, `/api/v1/packs/{slug}`, and the OpenAPI file at `/api/v1/openapi.json`.
  - No key is needed to search or download.
  - Rule: "catalogue-wide mirroring is not permitted". Fetch only what the game uses.
- Style: flat low-poly colors. These packs match the toon look of the game.

Packs that fit the level:

| Pack (slug) | Models | Use in Skate ATL |
|---|---|---|
| `skate-park-and-street-sports` | 47 | M1-04: quarter pipe (96 triangles), half pipe section (180), bank ramp (24), funbox with rail (116), grind box (92), ledge block (28), flat and kinked rails (216 each), 3-step and 5-step stairs, stair handrail (104), bowl walls and coping, inline skates, boombox, bleacher, floodlight mast |
| `street-food-market-and-food-trucks` | 49 | Krog Street Market and Ponce City Market plazas: food trucks with serving hatches (868 triangles), trestle tables, umbrellas, planters |
| `city-park-and-playground` | 41 | Historic Fourth Ward Park: paths, fences, benches, a gazebo, play equipment |
| `stylized-trees-and-rocks-kit` | 49 | More tree and shrub kinds next to the Blender kit (oak young 261 triangles, ancient oak 861) |
| `bus-station-and-city-transit` | 38 | Street lamps (120 triangles), guard rails, bus shelters on the streets near the trail |
| `allotments-and-community-garden` | 51 | Community gardens along the trail |
| `live-music-venue-and-festival-stage` | 55 | Event dressing, for example a stage for a BeltLine event |

Each pack also has a starter scene and a walkable demo layout (`/api/v1/demos`). These show how the parts fit together.

### Polyfork (https://polyfork.dev)

- What: 2,856 free low-poly assets. Each asset is a three.js ES module with "knobs" (color, wear, season, and more), and also a GLB, FBX, USDZ, or OBJ file. One shared material on most models.
- License (from https://polyfork.dev/licensing):
  - Commercial use is permitted, and attribution is not required.
  - "Your game can ship the models inside it."
  - You cannot resell or redistribute the files as standalone assets. Re-uploads to asset packs or template libraries are not permitted.
  - You cannot use the files to train a commercial asset generator.
  - The page does not address public repositories. The repository is private now, so a commit is inside the game. If the repository becomes public, load the files from the Polyfork CDN or ask Polyfork first.
- Access:
  - MCP: `https://polyfork.dev/mcp` (Streamable HTTP, no install). The tools include `search_assets`, `get_kit`, `find_matching`, and `get_terrain`.
  - REST: `https://polyfork.dev/api/assets?q=&class=&kit=&max_triangles=`, `/api/kits/{id}`.
  - Downloads: `/cdn/{id}.glb` and `/cdn/{id}.mjs` need no key. A free key gives a kit zip.
- Characters: each character uses one Mixamo-named skeleton (31 bones). The files have no animation clips. The free clips play through `/cdn/clips.mjs`, and Mixamo clips retarget through `/cdn/mixamo.mjs`.

Kits that fit the level:

| Kit (id) | Parts | Use in Skate ATL |
|---|---|---|
| `skatepark-0922a9` | 60 | NPCs (#41): Roller Skater (4960 triangles), Street Skater, Vert Skater, Longboarder, Skate Coach, Skate Filmer, Beginner Kid Skater, BMX Rider, Scooter Kid. All have a skeleton. Also a skate shop, a clubhouse, a container snack kiosk, a pump track, a wallride wall, steel rails, and a red brick bank |
| `nyc-city-kit-fbca88` | 73 | Street furniture: Globe Lamp, Bus Shelter, Fire Hydrant, Mailbox, Newsstand, Street Tree, Food Truck. Several have a night mode (`has_night`) |
| `neighborhood-pathways-kit-a992cf` | 61 | Inman Park and Old Fourth Ward homes: porch-front cottage, townhouse row unit, Little Free Library post, picnic shelter, cobra-head street light |
| `construction-site-9e40b0` | 62 | Permitted obstacles (AGENTS.md): Site Traffic Cone (122 triangles), Site Hoarding Run, Mesh Site Fence Run, Site Safety Sign Board |

### Assets to exclude (AGENTS.md political rules)

Do not use these models, whatever the license:

- Police: Police Officer, Police Cruiser, Police Barricade (NYC kit).
- Graffiti: Graffiti Artist, Graffiti Wall Decal, Spray Paint Can (Polyfork skatepark kit), and Graffiti Wall Panel (3dassets skate park pack). Use the mural system (`src/render/murals.js`) instead.
- Decline: Abandoned Shopping Trolley (Polyfork skatepark kit).
- Traffic danger: Temporary Traffic Light and moving traffic. Parked vehicles are permitted.

## Methods and tools

| Link | What it shows | Value for Skate ATL |
|---|---|---|
| [mukadeshinigami](https://x.com/mukadeshinigami/status/2115580095511617850): article "How to make pro-level PBR textures from a single reference (Blender + Claude)" | Build a PBR set from one real texture. Generate each map (albedo, height, normal, roughness, AO) separately, with 2 to 4 candidates. Pick the albedo with the least baked light. Align every map to the albedo with optical flow on edges, to under 0.5 px. Rebuild the normal from the aligned height. Clamp the roughness (0.35 to 1 for matte surfaces). | High. The landmark brick, stone, and metal maps (`src/render/landmark-materials.js`) are procedural canvas noise now. The article says that noise reads as fake next to a real scan. Use CC0 scans (for example Poly Haven) as the base, then align and tile them. Keep the textures small for the browser. The article itself says that real displacement is "too much for games". |
| [zavrenn](https://x.com/zavrenn/status/2116564845860360225): a small city in Three.js r187, built with Codex and no imported models | The video shows a plaza with a fountain, an elevated rail loop with a station, a gazebo pond, lamps, and cafe umbrellas. All of it is built in code. | Medium. It proves that code-built detail can reach this density in Three.js. The game already uses this approach. The lesson is density: many small props per plaza, and lit windows. |
| [3DxDEV7](https://x.com/3DxDEV7/status/2116463999935975713): iCity, a Blender add-on that builds a city in about 30 s | Roads, towers, parks, a wet-road option, and a night mode with lit windows. | Low. It is a Blender add-on, and the game builds from OpenStreetMap data in JavaScript. Two ideas apply: a night mode with a random lit-window probability, and a wetness control. |
| [matt503ea5sf9z5](https://x.com/matt503ea5sf9z5/status/2116766863631774206): a city tool in a custom Zig engine | A custom tool that builds buildings and moves streets. | Low. It confirms the pipeline in this repository: build the level from data with agents, with no scene editor. |
| [alightinastorm](https://x.com/alightinastorm/status/2117066551316951380): "Vibe Human 2.0", a Three.js human creator | IK rig, procedural walk, clothing, and AI skins, built in a weekend. The author plans to open-source it. | Medium, later. It can be a source of more playable skaters (#42) if it becomes open source. No repository or license exists yet. Check again before #42. |
| [CY160909](https://x.com/CY160909/status/2116708301211599133): [Open 3D Skills](https://github.com/Moh4696/open-3d-skills) (MIT) | 8 agent skills: three.js scenes, scroll films, exploded views, browser checks, and 60 fps recording. | Medium. The `frame-capture` skill (60 fps recording) can make the trailer and playtest videos. The browser-check skill overlaps with the Playwright checks here. Install with `npx skills add Moh4696/open-3d-skills --skill <name>`. |
| [repalash](https://x.com/repalash/status/2116478976013255020): [three-motionbricks](https://github.com/repalash/three-motionbricks) (Apache-2.0) | NVIDIA MotionBricks in Three.js: a robot that walks and runs, with the motion generated in the browser. | Low now. The model is 190 MB (194 MB on phones), and it drives a Unitree G1 robot, not a human skater. The NVIDIA Open Model Agreement covers the model weights. The sample motions are for evaluation only. The "white city" demo shows a clean, low-detail city look. |
| [NicolasZu](https://x.com/NicolasZu/status/2116601766410326177): [gamedev-cheatsheet.com](https://gamedev-cheatsheet.com/) | 34 game development concepts with example prompts: game feel (coyote time, easing, screen shake, squash and stretch, camera deadzone, input buffering, hit stop) and performance (LOD, draw calls, chunk streaming). | Medium. Use the vocabulary in prompts and issues. The game feel concepts apply to the skate controller. Chunk streaming applies when the level grows past one block. |
| [cutetoxicguy](https://x.com/cutetoxicguy/status/2116530826586263715): [Construct 1.0](https://github.com/rtmandreyev/construct) (Apache-2.0; Blender add-on GPL-3.0) | An agent researches a real object (dimensions, photos), writes a structured scene, and a deterministic engine builds it. Each detail has a provenance label: verified, supplied, inferred, or decorative. It exports GLB with named parts and joints. | High as a method. It is the same idea as img2threejs, plus a research step for real dimensions and a provenance label on each part. Add the provenance labels to the landmark specs, so a reviewer sees which dimensions come from a source. The Construct models are holographic blockouts, so the game does not use them directly. |
| [PermitZIPhvac](https://x.com/PermitZIPhvac/status/2117049163976245282): Mutiny BIM | A recruitment post for an open BIM (building information) tool. | None for the game. |

## Recommended next steps

1. M1-04 (rails, ledges, ramps): use the 3dassets.dev `skate-park-and-street-sports` pack (CC0). Place ledges, rails, stairs, and a bank ramp by script on real features. Add one `provenance.json` with the asset slugs, the CC0 license, and `aiGenerated`. The pieces are 24 to 216 triangles each, so the 55 FPS gate has room.
2. #41 NPCs: test the Polyfork skatepark characters (Roller Skater, Street Skater, Skate Coach, Skate Filmer) with the free clips. They share one Mixamo skeleton, so one clip set drives all of them.
3. Plazas: dress the Krog Street Market and Ponce City Market plazas with the food truck and park packs, inside the prop LOD tiles (`src/level/geo/props.js`).
4. Materials: build the brick and stone maps from CC0 scans with the article's alignment steps. Then compare them with the canvas maps in the game.
5. Landmark specs: add a provenance label (verified, supplied, inferred, decorative) per part, as Construct does.

## What was not verified

- No asset was downloaded into the game or tested at 55 FPS.
- The style match comes from the pack cover images only.
- The 3dassets.dev full license text was read through a summary tool, and only short quotes were checked.
- The Polyfork public-repository question is open. The repository is private now.
- The mukadeshinigami article images and code blocks were not in the API text. Only the prose was read.
