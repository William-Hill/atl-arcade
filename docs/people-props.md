# Pedestrians, street furniture and BeltLine props (assets/people, assets/props/street, assets/props/beltline)

Meshy-generated models for the pbr look (#133, #115): models only. Nothing in the game loads them yet; this note is how to place them.

- Generator: `node scripts/assets/meshy-people-props.mjs --cap 400` (Meshy text-to-3D meshy-t2.5, rigging, library clips; raw files in git-ignored `.meshy-raw/people/`), then `node scripts/assets/people-props-build.mjs` (Blender headless: `scripts/blender/people.py`, `people_props.py`, `dog_rig.py`; Draco level 7, 1K base color, 512 normal, 256-512 metal/rough).
- Manifests: `assets/<dir>/manifest.json`. Per asset: `file`, `bytes`, `triangles` (`lod0`, `lod1`), `lodDistance`, `bounds`, `size`, and for people and the dog `bones` and `clips` (game name → frames, fps, source clip, `shared_from`). Provenance: `assets/<dir>/provenance.json` (prompt, Meshy task ids, credits per step).
- Frame: glTF model space, +y up, +z forward (the way a person faces; check vehicles and carts in the preview before relying on their nose direction), origin at the ground center, meters. Yaw is Three.js `rotation.y`.
- Preview: `scripts/assets/people-props-preview.html` (the real game in `?look=pbr`, every asset on a pad beside the Beltline trail; `?only=id,..`, `?clip=walk|idle|sit|cheer|run`, `?lod=0|1`, `?pad=0`, `?plaza=x,z,yaw`, `?peopleprops=0` for BEFORE). Shots: `node scripts/assets/people-props-shots.mjs --out DIR`.

## People (assets/people)

| id | who | clips |
| --- | --- | --- |
| `walker_sundress` | young woman, yellow sundress, tote | walk, run, idle, cheer, sit |
| `elder_polo` | older man, blue shirt, khakis | walk, run, idle, cheer, sit |
| `jogger` | woman in a running top | walk, run, rest, idle, cheer, sit |
| `dog_walker` | man in a light jacket (pair with `dog`) | walk, run, idle, cheer, sit |
| `stroller_dad` | dad in a hoodie (pair with `stroller`) | walk, run, idle, push, cheer, sit |
| `cyclist` | man in helmet and jersey (pair with `city_bike`) | walk, run, idle, cheer, sit, ride |
| `dog` | medium tan dog, own 14-bone rig | walk, idle |
| `stroller` | teal stroller, static | |

- All six people share Meshy's 24-bone humanoid skeleton (same bone names), so any clip plays on any person; clips marked `shared_from` were retargeted that way for free. Clips play in place: move the root along the path at about 1.4 m/s (walk) or 2.8 m/s (run).
- LOD: one `SkinnedMesh` per LOD (`<id>_lod0` about 6k triangles, `<id>_lod1` 1.2k) bound to the same skeleton; show lod1 past `lodDistance` (25 m people, 20 m dog/props). Past about 80 m keep the existing box figures (`src/render/npc-view.js`).
- Budget: load each GLB once and `SkeletonUtils.clone()` per instance (as `src/render/npc-skaters-view.js` does for Nia/Marcus); clones share geometry and textures, so the GPU cost is per person type (6 × about 1.6 MB of textures), not per pedestrian. Cap full models at about 8 near the camera (3 on low quality): about 50k triangles and 8 skinned draw calls, plus lod1s.
- `sit`: the pelvis lowers to chair height with no seat in the model; put the root on the ground at the front edge of a bench or the `picnic_table` bench, facing away from it.
- `push` (stroller_dad): parent the `stroller` about 0.6 m ahead along +z. `dog_walker`: the `dog` walks about 1.2 m ahead and 0.5 m to the side (no leash mesh). `cyclist` `ride` is a held seated pose: parent the person to the `city_bike` so the pelvis is over the saddle, and spin nothing (the bike is static).

## Street furniture (assets/props/street)

`drinking_fountain` (1.0 m), `bollard` (0.9 m), `traffic_cone` (0.7 m), `barricade` (1.2 m wide, construction only). The fountain and the bollard are the two OSM furniture kinds `FURNITURE_PROP` maps to `null` today (`drinking_water`, `bollard` in `src/level/geo/props.js`, PR #143): point those entries at these GLBs, one `InstancedMesh` per LOD per prop. Cones and barricades go only around construction (no danger, no police).

## BeltLine props (assets/props/beltline)

`e_scooter` and `city_bike` (parked, on their own stand; rows of them beside `bike_dock` make a docked station), `bike_dock` (1.5 m, two slots), `food_cart` (2.2 m, blank awning, no brand), `picnic_table` (1.8 m), `patio_umbrella` (2.5 m tall, open, pair with a picnic table), `sculpture_ribbon` (4 m, original abstract steel ribbon on a plinth, lod1 at 60 m so it reads from the trail). Static props: instance them like the street furniture. Keep them off the trail itself: on the shoulders, plazas and the Krog/Ponce side lots.
