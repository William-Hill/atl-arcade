# Game development cheat sheet: audit for Skate ATL

Source: https://gamedev-cheatsheet.com/ (34 concepts), read on 2026-10-31.

This file compares each concept with the code. "Done" means the code has it now. "Gap" means the code does not have it. The milestone column gives the time to add it.

## Game feel and systems

| Concept | Status | Where, or what to do | When |
|---|---|---|---|
| Raycasting | Done | The camera wall ray (`src/render/follow-camera.js`) and the ground sampler. | — |
| Normals | Done | `groundNormal` sets vert, ramps, launch, and the wall probe (`SKATE.launchNormalY`, `rampNormalY`). | — |
| Delta time | Done | All sim code multiplies by `dt`. Smoothing uses `1 - exp(-k dt)` (`smoothFactor`). The render clamps `dt` to 0.1 s. The cheat sheet says 0.05 s. | — |
| Fixed timestep | Partial | The sim runs at 60 Hz (`src/sim/fixed-step.js`). The render does not interpolate between the last two states, so a 144 Hz screen can show judder. Use the `alpha` fraction that `fixed-step.js` already gives. | M1 |
| Acceleration and friction | Done (2026-10-31) | Stroke thrust and roll friction (`SKATE.pushAccel`, `coastDecel`, `coastDrag`). | — |
| Coyote time | Done (2026-11-01) | A jump press up to 0.12 s after a roll off an edge still jumps (`SKATE.coyoteTime`). It gives one jump only, and only after a roll-off. | — |
| Input buffering | Gap | A jump press just before a landing is lost. Keep the jump press for 0.1 s and fire it on the first grounded frame. Also buffer the grind button before a rail. | M1 |
| Easing | Partial | The camera uses exponential smoothing. The HUD and the menus do not exist yet. Use easeOutCubic for UI moves. | M2 |
| Screen shake | Gap | Add trauma-based shake (trauma squared times smooth noise) on a hard landing and on a bail. Keep it small and add an option to turn it off (accessibility). | M2 |
| Squash and stretch | Not for this game | The skater is a rigged human. The land clip has a knee bend that does this job. | — |
| Camera deadzone | Not used | A 3D follow camera behind the skater does not use a screen deadzone. The look-ahead and the yaw smoothing do this job. | — |
| Hit stop | Optional | A short freeze (50 ms) on a perfect on-beat landing can make the beat bonus feel strong. Test it in a playtest first. | M2 |
| Invincibility frames | Not for this game | The game has no damage. | — |
| Hitbox and hurtbox | Not for this game | The game has no combat. | — |
| Finite state machine | Done | The controller states `rolling`, `air`, and `grind`, and the clip table in `src/render/skater-anim.js`. | — |
| Object pooling | Gap | Add pools for particles (wheel sparks on grinds, landing dust) when the game gets them. | M2 |
| Particle system | Gap | Grind sparks, landing dust, and beat-hit confetti. Use one emitter with a pool. | M2 |
| Steering behaviors | Later | For crowds of NPC skaters at the rink and on the BeltLine. | M2 |
| A* pathfinding | Not needed now | NPCs can follow splines. | — |
| Tunneling | Partial | The wall probe looks ahead by `bodyRadius`. At 12 m/s she moves 0.2 m per step, which is less than the probe, so she does not tunnel now. A speed above 18 m/s needs a swept test. | Check when maxSpeed changes |
| Seeded noise | Later | For any generated city detail (tree position, crowd color) so that a neighborhood looks the same on each visit. | M1 |

## 3D and rendering, performance

| Concept | Status | What to do | When |
|---|---|---|---|
| Level of detail | Gap | Real neighborhoods have many buildings. Add two or three LOD steps for extruded blocks and props, with hysteresis. | M1 |
| Frustum culling | Partial | Three.js culls each mesh by its bounding sphere by default. Merged city blocks must keep small enough bounds to cull. | M1 |
| Draw calls | Gap | Instance repeated props (cones, benches, rails, trees) with `InstancedMesh`, and merge static blocks that share a material. | M1 |
| Texture atlas | Gap | Pack mural and prop textures into atlases for the neighborhood builds. | M1 |
| Chunk streaming | Later | Stream neighborhood chunks with two radii (load and unload) for a big map. | M2 |
| Frame budget | Partial | The playtest harness records frame time (`__atl.fps`). Add a per-system time (input, sim, render) before any optimization. | M1 |
| Spatial partitioning | Later | Rapier has a broad phase. The ground sampler needs a grid when a neighborhood has thousands of colliders. | M1 |
| Z-fighting | Check | The camera near plane is 0.1 and the far plane is 500. Murals on walls must sit 1 cm off the wall or use polygon offset. | M1 |
| Billboarding | Later | For name tags and score pop-ups. | M2 |
| Quaternions | Done | The rig uses quaternions. The sim yaw is one angle, so it has no Euler problem. | — |
| Fragment shader | Later | For the cel shading of the blocks and for the mural look. | M1 |
| Overdraw | Later | Cap smoke and confetti particles. | M2 |
| Time slicing | Later | For NPC decisions. | M2 |

## Suggested next steps

1. A jump and grind input buffer. This is a small change in `src/sim/skate/controller.js` with unit tests.
2. Render interpolation with the fixed-step `alpha`.
3. Instancing and LOD when the first real neighborhood loads (M1).
