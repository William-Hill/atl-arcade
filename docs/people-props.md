# Pedestrians, street furniture and BeltLine props (assets/people, assets/props/street, assets/props/beltline)

Meshy-generated models for the pbr look (#133, #115), and how the game places them.

## In the game

- People: `src/render/ped-models.js`. In the pbr look the walkers of `src/sim/peds.js` nearest the camera (5 on high, 3 on phone, none on low, within 45 m) are drawn as these people. Each drawn walker gets a different person from `walker_sundress`, `elder_polo`, `jogger`, `dog_walker` and `stroller_dad` (`assignPeople()`), so no person shows twice at once. The other walkers are procedural figures, each with its own height, build, hair, clothes and colors (`src/render/ped-look.js`, `src/render/peds-view.js`). The walk plays at the walker's pace (one cycle per `PEDS.stride` m), and the idle plays when the walker stops. `peds-view.js` skips those walkers (`sync(st, skip)`). The dog walker has the `dog` on a leash; the stroller dad pushes the `stroller`, whose wheels turn. `?pedglb=0` turns this off. The cyclist (no bike lane yet) and the sit pose are not used in the game.
- Props: `src/level/geo/props.js` places them, and `src/render/people-props-view.js` draws them: one `InstancedMesh` per mesh of each LOD, up to 160 m, with lod1 from the manifest `lodDistance`. They are also solids (`PROP_SOLID`) for the skater and the walkers. The OSM `drinking_water` and `bollard` points get `drinking_fountain` and `bollard` (`FURNITURE_PROP`). Along the trail, before the row trees: a picnic table with a patio umbrella every 160 m, plus a food cart at every second stop; a bike dock with a city bike and an e-scooter every 200 m; a sculpture every 480 m. On beltline-eastside that is 3 fountains, 2 bollards, 13 tables, 12 umbrellas, 6 food carts, 7 docks, 7 bikes, 7 scooters and 4 sculptures. `?meshyprops=0` hides them; they still stand as solids. Parked bikes and scooters don't move.
- Not placed: cones and barricades (no construction data yet).

- Generator: `node scripts/assets/meshy-people-props.mjs --cap 400` (Meshy text-to-3D meshy-t2.5, rigging, library clips; raw files in git-ignored `.meshy-raw/people/`; the six people were remade with `--only <the six> --out .meshy-raw/people-v2 --model meshy-7.1 --polycount 15000 --no-anim`, and the build takes their skins from `people-v2/` and the clips bought with the first bodies from `people/`), then `node scripts/assets/people-props-build.mjs` (Blender headless: `scripts/blender/people.py`, `people_props.py`, `dog_rig.py`; Draco level 7, 1K base color, 512 normal, 256-512 metal/rough).
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

- All six people share Meshy's 24-bone humanoid skeleton (same bone names), so any clip plays on any person; clips marked `shared_from` were retargeted for free. Each Meshy rig has its own rest orientations, so `people.py` bakes a shared clip bone by bone in armature space relative to the rest pose (copying local rotations tilts the body). Clips play in place: move the root along the path at about 1.4 m/s (walk) or 2.8 m/s (run).
- LOD: one `SkinnedMesh` per LOD (`<id>_lod0` about 15k triangles, `<id>_lod1` 1.2k) bound to the same skeleton; show lod1 past `lodDistance` (25 m people, 20 m dog/props). Past about 80 m keep the existing box figures (`src/render/npc-view.js`).
- Budget: load each GLB once and `SkeletonUtils.clone()` per instance (as `src/render/npc-skaters-view.js` does for Nia/Marcus); clones share geometry and textures, so the GPU cost is per person type (6 × about 1.6 MB of textures), not per pedestrian. Cap full models at the count of person kinds near the camera (5 on high, 3 on phone, 0 on low), so no person shows twice: about 78k triangles and 5 skinned draw calls on high, plus lod1s.
- `sit`: the pelvis lowers to chair height with no seat in the model; put the root on the ground at the front edge of a bench or the `picnic_table` bench, facing away from it.
- `push` (stroller_dad): the walk with both hands on the stroller handle, keyed in Blender with two-bone IK (`scripts/blender/people_ik.py`); parent the `stroller` 0.64 m ahead along +z. `dog_walker`: the `dog` at about 0.75 m to the side, on a leash: a thin tube rebuilt each frame from the walker's `LeftHand` bone to the dog's `neck` bone, hanging by its slack (`leashPoints` in `src/render/leash.js`, 1.1 m; `LEASH` in the preview). `cyclist` `ride`: a 1 s pedaling loop on the bike, same IK (pelvis on the saddle, hands on the grips, feet on the pedal circle); parent the person to the `city_bike` at the same origin and yaw. The `city_bike`, `e_scooter` and `stroller` wheels (and the bike's crank) are their own nodes under `<id>_lod0`, pivoted on the axle and turned by one clip (`scripts/blender/prop_wheels.py`; axles, triangles and turns per loop are in the manifest `parts`): `city_bike` `ride` (1 s: the crank one turn in phase with the cyclist's feet, the wheels two), `stroller` `push` (1 s, as the stroller_dad's push), `e_scooter` `roll` (1 s, three turns). Start the prop's clip with its person's, at the same time; leave parked bikes and scooters still. The far LOD (`_lod1`) has no wheel nodes and does not move. The preview stages these pairs (`COMPANIONS` in `people-props-preview.js`), and the `elder_polo` sit on the `picnic_table` bench (table at x 0.18, z 0.31).

## Street furniture (assets/props/street)

`drinking_fountain` (1.0 m), `bollard` (0.9 m), `traffic_cone` (0.7 m), `barricade` (1.2 m wide, construction only). The fountain and the bollard fill the two OSM furniture kinds that had no prop (`drinking_water`, `bollard` in `FURNITURE_PROP`, `src/level/geo/props.js`); see "In the game". Cones and barricades go only around construction (no danger, no police).

## BeltLine props (assets/props/beltline)

`e_scooter` and `city_bike` (parked, on their own stand; rows of them beside `bike_dock` make a docked station), `bike_dock` (1.5 m, two slots), `food_cart` (2.2 m, blank awning, no brand), `picnic_table` (1.8 m), `patio_umbrella` (2.5 m tall, open, pair with a picnic table), `sculpture_ribbon` (4 m, original abstract steel ribbon on a plinth, lod1 at 60 m so it reads from the trail). Static props: instance them like the street furniture. Keep them off the trail itself: on the shoulders, plazas and the Krog/Ponce side lots.
