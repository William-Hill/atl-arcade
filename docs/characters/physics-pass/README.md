# Physics pass, athletic stance, joint limits, recoil, and a faster push drive (2026-11-21)

`scripts/blender/skater_physics_pass.py` changed these clips in headless Blender 5.2.3: `push`, `coast`, `carve_left`, and `carve_right` (the mirror of the new `carve_left`). It did this for Nia and for Marcus. Cascadeur did not run in the cloud container (see `docs/decisions.md`, 2026-11-21).

The pass has five parts:

0. Athletic stance (coast and push), from owner feedback: the coast looked upright. The derby and coaching cues are: bend at the knees and the hips, not at the waist; keep the back straight and the chest and head up; put the shoulders, knees, and toes in one vertical line; keep the weight over the skates. The pass hinges the body forward at the hips until the shoulders are over the knees, lowers the hips in the coast to 0.78 of the leg length, keeps the gaze level, and brings the arms a little forward in the coast.
1. Physics: centre of mass, ZMP balance, less fore-aft sway on free rollers, smoothing, and the skates kept on the ground.
2. Recoil: the Crossroads attacker recoil rule (`William-Hill/crossroads`, `docs/animation/attacker-recoil-rule.md`, #765). At the end of each push stroke, at each step that lands in the carve, and on each downbeat of the coast, the body mass continues along its momentum and comes back one time. The pelvis moves first, then the chest, the upper arms, and the head, each 1 frame later.
3. A faster push drive: the Crossroads recipe (the swing length times 10/18, a deeper load before it). Each push drive (both skates on the ground, from the touch-down of the other skate to the lift-off) plays in 10/18 of its frames. The lift-off frames and the clip length stay the same. The other skate lands later, so the glide on one skate gets the saved frames. The hips dip 1 cm more at the start of each drive. In the push, the hips can move up to 12 cm to the side over the glide skate (6 cm in the other clips).
4. Joint limits: the Crossroads joint-limit gate (`pipeline/joint_limit_gate.py`, #465), ported to the Mixamo rig in `scripts/blender/skater_joint_limits.py`. A clip past LIMITS gets a WARN, and a clip past IMPOSSIBLE gets a FAIL.

## Files

- `videos/<skater>-before-after.mp4` and `videos/<skater>-before-after-half-speed.mp4`: before (`main`) on the left, after on the right, three-quarter view on top and side view below. The clips are push, coast, carve_left, and carve_right; the short clips play two times. Made with `scripts/skater-clip-frames.mjs` (one PNG for each 30 fps frame from `skater.html`) and ffmpeg (`xstack`, then `setpts=2*PTS` for half speed).
- `compare/<skater>-<clip>.jpg`: before (`main`) and after, at t = 0, 1/3, and 2/3 of the clip, from the three-quarter view and the left view. Made with `scripts/skater-clip-shots.mjs` from `skater.html?skater=<skater>` in headless Chromium.
- `compare/<skater>-push-recoil.jpg`: 8 frames around the end of one push stroke, before and after. These frames show the recoil.
- `before.json`, `after.json`: the lowest skinned vertex at each 30 fps frame in the browser (the ground is y = 0), and the console errors (0).
- `<skater>-metrics.json`: the Blender measures before and after, the recoil events, the joint-limit results, and the settings.
- `<skater>-joint-limits.json`: the joint-limit gate on every clip of the new GLB.

## Measures (before = main -> after)

ZMP excess: the mean distance (m) of the zero moment point outside the support polygon of the skates on the ground. 0 = balanced on all frames. CoM jerk: the RMS of the third derivative of the centre of mass (m/s^3). The recoil adds a bounce, so it adds jerk on purpose.

| Clip | ZMP excess mean (m) | CoM vertical accel (m/s^2) | CoM jerk RMS | Lowest wheel, browser (m) | Joint limits |
|---|---|---|---|---|---|
| Nia push | 0.088 -> 0.000 | -8.7..2.5 -> -2.3..2.3 | 44 -> 38 | -0.000 -> 0.000 | PASS -> PASS |
| Nia coast | 0.000 -> 0.000 | -0.2..0.3 -> -0.9..1.5 | 4 -> 23 | -0.000 -> -0.000 | PASS -> PASS |
| Nia carve_left | 0.154 -> 0.060 | -9.8..7.7 -> -3.9..5.5 | 58 -> 51 | -0.039 -> -0.000 | PASS -> PASS |
| Nia carve_right | 0.148 -> 0.063 | -9.8..7.7 -> -3.9..5.5 | 58 -> 51 | -0.040 -> -0.001 | PASS -> PASS |
| Marcus push | 0.129 -> 0.000 | -12.0..3.6 -> -3.3..2.8 | 69 -> 40 | -0.000 -> 0.000 | PASS -> PASS |
| Marcus coast | 0.000 -> 0.000 | -0.4..0.6 -> -0.7..1.8 | 16 -> 25 | -0.000 -> 0.000 | PASS -> PASS |
| Marcus carve_left | 0.133 -> 0.023 | -6.3..7.1 -> -6.0..9.1 | 85 -> 86 | -0.000 -> 0.000 | PASS -> PASS |
| Marcus carve_right | 0.125 -> 0.026 | -6.2..7.0 -> -6.0..8.9 | 85 -> 87 | -0.000 -> -0.000 | PASS -> PASS |

Athletic stance (trunk lean: the Hips-to-Neck line from the vertical; hip-ankle: the hip joint to ankle distance over the leg length; shoulders ahead of knees: + = the shoulders are in front of the knees):

| Clip | Trunk lean (deg) | Hip-ankle / leg | Shoulders ahead of knees (m) | Hip hinge added (deg) |
|---|---|---|---|---|
| Nia push | 17.2 -> 33.2 | 0.734 -> 0.737 | -0.104 -> -0.002 | 16 |
| Nia coast | 7.5 -> 34.5 | 0.863 -> 0.791 | -0.179 -> 0.001 | 27 |
| Marcus push | 21.3 -> 24.3 | 0.685 -> 0.686 | -0.026 -> -0.002 | 3 |
| Marcus coast | 12.1 -> 24.1 | 0.831 -> 0.785 | -0.101 -> 0.001 | 12 |

Push drive (one stroke; both strokes are the same):

| Skater | Drive frames | Drive skate peak speed against the hips (m/s) | Frames |
|---|---|---|---|
| Nia | 15 -> 8 | 0.85 -> 1.85 | lift-off [19, 45]; touch-down [4, 30] -> [11, 37] |
| Marcus | 13 -> 7 | 1.40 -> 2.76 | lift-off [16, 38]; touch-down [3, 25] -> [9, 31] |

The clip lengths (frames at 30 fps) do not change: Nia push 52, coast 96, carves 48; Marcus push 44, coast 48, carves 48. All clips loop with no error and have no root travel. The joint-limit gate passes on every clip of both new GLBs, with one WARN that was already on `main`: Marcus `dance_drumline`, left knee 30.9 degrees off its hinge (limit 30).

## What did not improve

- Nia carve: on beat 2 the right skate lifts for 13 frames. Nia then stands on the left skate only, and that skate drags 10 to 27 cm behind her centre of mass. The pass cannot fix this with a hips shift of 6 cm or less. The step or the drag must change. A real skater must review this.
- Marcus carve: the step landings now have a recoil, and the upward CoM acceleration peak went from 7.1 to 9.1 m/s^2 (0.93 g). The jerk is the same as on `main` (85 -> 86). Look at it in the game.
- Push: the drive is twice as fast, but the game moves the skater at the speed of the sim, not of the clip. If the push impulse of the sim does not come at the drive, the feet and the speed do not agree. Look at it in the game.
- Coast: the stance is now low and leaning, and the recoil on each downbeat adds a small bounce. The jerk is higher than on `main` (Nia 4 -> 23). A person must decide if it feels better.
- Stance: the lean of Nia (34 degrees) is more than the lean of Marcus (24 degrees), because the rule puts the shoulders over the knees and the two rigs have different proportions and knee angles. The game references (Jet Set Radio, Bomb Rush Cyberfunk) were not measured: no written analysis of their skate poses was found, and video was not watched in this session. Hi-Fi Rush has no roller skating; its lesson is rhythm (the end of each action lands on the beat).
- The recoil is small: 1.1 to 1.4 cm of pelvis after the balance solve, 2.5 to 5 degrees of chest. A person must look at it at game speed.
