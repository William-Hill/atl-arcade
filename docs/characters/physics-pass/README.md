# Physics pass, joint limits, and recoil on push, coast, and carve (2026-11-21)

`scripts/blender/skater_physics_pass.py` changed these clips in headless Blender 5.2.3: `push`, `coast`, `carve_left`, and `carve_right` (the mirror of the new `carve_left`). It did this for Nia and for Marcus. Cascadeur did not run in the cloud container (see `docs/decisions.md`, 2026-11-21).

The pass has three parts:

1. Physics: centre of mass, ZMP balance, less fore-aft sway on free rollers, smoothing, and the skates kept on the ground.
2. Recoil: the Crossroads attacker recoil rule (`William-Hill/crossroads`, `docs/animation/attacker-recoil-rule.md`, #765). At the end of each push stroke, at each step that lands in the carve, and on each downbeat of the coast, the body mass continues along its momentum and comes back one time. The pelvis moves first, then the chest, the upper arms, and the head, each 1 frame later.
3. Joint limits: the Crossroads joint-limit gate (`pipeline/joint_limit_gate.py`, #465), ported to the Mixamo rig in `scripts/blender/skater_joint_limits.py`. A clip past LIMITS gets a WARN, and a clip past IMPOSSIBLE gets a FAIL.

## Files

- `compare/<skater>-<clip>.jpg`: before (`main`) and after, at t = 0, 1/3, and 2/3 of the clip, from the three-quarter view and the left view. Made with `scripts/skater-clip-shots.mjs` from `skater.html?skater=<skater>` in headless Chromium.
- `compare/<skater>-push-recoil.jpg`: 8 frames around the end of one push stroke, before and after. These frames show the recoil.
- `before.json`, `after.json`: the lowest skinned vertex at each 30 fps frame in the browser (the ground is y = 0), and the console errors (0).
- `<skater>-metrics.json`: the Blender measures before and after, the recoil events, the joint-limit results, and the settings.
- `<skater>-joint-limits.json`: the joint-limit gate on every clip of the new GLB.

## Measures (before = main -> after)

ZMP excess: the mean distance (m) of the zero moment point outside the support polygon of the skates on the ground. 0 = balanced on all frames. CoM jerk: the RMS of the third derivative of the centre of mass (m/s^3). The recoil adds a bounce, so it adds jerk on purpose.

| Clip | ZMP excess mean (m) | CoM vertical accel (m/s^2) | CoM jerk RMS | Lowest wheel, browser (m) | Joint limits |
|---|---|---|---|---|---|
| Nia push | 0.088 -> 0.003 | -8.7..2.5 -> -3.3..3.0 | 44 -> 40 | 0.000 -> 0.000 | PASS -> PASS |
| Nia coast | 0.000 -> 0.000 | -0.2..0.3 -> -0.9..1.5 | 4 -> 23 | 0.000 -> 0.000 | PASS -> PASS |
| Nia carve_left | 0.154 -> 0.071 | -9.8..7.7 -> -4.4..5.0 | 58 -> 40 | -0.039 -> 0.000 | PASS -> PASS |
| Nia carve_right | 0.148 -> 0.074 | -9.8..7.7 -> -4.4..5.0 | 58 -> 40 | -0.040 -> -0.001 | PASS -> PASS |
| Marcus push | 0.129 -> 0.017 | -12.0..3.6 -> -4.1..3.3 | 69 -> 48 | 0.000 -> 0.000 | PASS -> PASS |
| Marcus coast | 0.000 -> 0.000 | -0.4..0.6 -> -0.7..1.8 | 16 -> 25 | 0.000 -> 0.000 | PASS -> PASS |
| Marcus carve_left | 0.133 -> 0.032 | -6.3..7.1 -> -5.9..9.1 | 85 -> 87 | 0.000 -> 0.000 | PASS -> PASS |
| Marcus carve_right | 0.125 -> 0.037 | -6.2..7.0 -> -6.0..8.9 | 85 -> 88 | 0.000 -> 0.000 | PASS -> PASS |

The clip lengths (frames at 30 fps) do not change: Nia push 52, coast 96, carves 48; Marcus push 44, coast 48, carves 48. All clips loop with no error and have no root travel. The joint-limit gate passes on every clip of both new GLBs, with one WARN that was already on `main`: Marcus `dance_drumline`, left knee 30.9 degrees off its hinge (limit 30).

## What did not improve

- Nia carve: on beat 2 the right skate lifts for 13 frames. Nia then stands on the left skate only, and that skate drags 10 to 27 cm behind her centre of mass. The pass cannot fix this with a hips shift of 6 cm or less. The step or the drag must change. A real skater must review this.
- Marcus carve: the step landings now have a recoil, and the upward CoM acceleration peak went from 7.1 to 9.1 m/s^2 (0.93 g). The jerk is the same as on `main` (85 -> 87). Look at it in the game.
- Coast: the smoothing made it calmer, and the recoil on each downbeat adds a small bounce again (pelvis 7 mm after the balance solve). The jerk is higher than on `main` (Nia 4 -> 23). A person must decide if it feels better.
- The recoil is small: 1.1 to 1.4 cm of pelvis after the balance solve, 2.5 to 5 degrees of chest. A person must look at it at game speed.
