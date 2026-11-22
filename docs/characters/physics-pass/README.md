# Physics pass, athletic stance, clipping fix, arm IK, joint limits, recoil, and a faster push drive (2026-11-21)

`scripts/blender/skater_physics_pass.py` changed these clips in headless Blender 5.2.3: `push`, `coast`, `carve_left`, and `carve_right` (the mirror of the new `carve_left`). It did this for Nia and for Marcus. Cascadeur did not run in the cloud container (see `docs/decisions.md`, 2026-11-21).

The pass has five parts:

0. Athletic stance (coast and push), from owner feedback: the coast looked upright. The derby and coaching cues are: bend at the knees and the hips, not at the waist; keep the back straight and the chest and head up; put the shoulders, knees, and toes in one vertical line; keep the weight over the skates. The pass hinges the body forward at the hips until the shoulders are over the knees, lowers the hips in the coast to 0.78 of the leg length, keeps the gaze level, and brings the arms a little forward in the coast.
1. Physics: centre of mass, ZMP balance, less fore-aft sway on free rollers, smoothing, and the skates kept on the ground.
2. Recoil: the Crossroads attacker recoil rule (`William-Hill/crossroads`, `docs/animation/attacker-recoil-rule.md`, #765). At the end of each push stroke, at each step that lands in the carve, and on each downbeat of the coast, the body mass continues along its momentum and comes back one time. The pelvis moves first, then the chest, the upper arms, and the head, each 1 frame later.
3. A faster push drive: the Crossroads recipe (the swing length times 10/18, a deeper load before it). Each push drive (both skates on the ground, from the touch-down of the other skate to the lift-off) plays in 10/18 of its frames. The lift-off frames and the clip length stay the same. The other skate lands later, so the glide on one skate gets the saved frames. The hips dip 1 cm more at the start of each drive. In the push, the hips can move up to 12 cm to the side over the glide skate (6 cm in the other clips).
4. Joint limits: the Crossroads joint-limit gate (`pipeline/joint_limit_gate.py`, #465), ported to the Mixamo rig in `scripts/blender/skater_joint_limits.py`. A clip past LIMITS gets a WARN, and a clip past IMPOSSIBLE gets a FAIL.

## The carve clips

- Nia `carve_left` is the ATL Ryde corner step (2 beats, from the Dun Beezy lesson in `docs/characters/skate-style-references.md`): the right (outside) skate steps out wide, the left (inside) skate drags behind on its toe two times, then the right skate lifts and comes back in, in front of the left. The body leans into the turn and the shoulders turn with it.
- Marcus `carve_left` is jam crossovers (2 beats, `skater_anim_v3.py`): the right skate lifts and crosses over in front of the left skate, then the left skate comes out from under and steps wide to the left. His chest turns into the curve more than Nia's.
- `carve_right` is the mirror of `carve_left` for both skaters. The game plays the carve clip when the skater turns, and the renderer adds the bank lean of the turn.

## Nia's carve, beat 2 (owner feedback)

On beat 2 of the ATL Ryde corner step, the right skate is in the air for 13 frames (21 to 33). On `main`, Nia stood on the left skate only while it dragged on its toe stop, pitched 28 degrees up, 10 to 27 cm behind her centre of mass. Nobody can stand on a dragging toe stop with the body ahead of it.

The support layer (SUPPORT in `skater_physics_pass.py`, Nia's carve only) fixes the step. When one skate is in the air, the skate on the ground is levelled onto its wheels (its yaw stays) and rolls along its own heading until the centre of mass is over the middle of its wheelbase. A skate can roll along its heading without a skid, so this is a legal move on wheels. The roll is up to 21 cm. It starts while both skates are still down and ends after the right skate lands. The left skate still drags on its toe on beat 1 and beat 1&. The knee IK points the knee over the moved skate.

The landing bounce of a carve step now starts at the touch-down, not 3 frames before it. Nia's carve keeps the chest, arm, and head follow-through of the landing, but has no pelvis bounce there: the pelvis bounce came right after her one-skate step and moved her out of balance.

| Nia carve_left | Before (main) | After |
|---|---|---|
| ZMP excess, mean of beat 2 (frames 21-33) | 0.163 m | 0.039 m |
| ZMP excess, mean of the whole clip | 0.154 m | 0.040 m |
| Support skate during beat 2 | on its toe stop, behind her | flat on its wheels, under her |

What is left: beat 1& (frames 10 to 13, both skates down) is still out by up to 0.19 m, and the frame of the touch-down by 0.21 m. A real skater must review the corner step.

Close-up: `compare/closeup-nia-carve-beat2.jpg` (frames 21, 27, 32, before and after).

## Marcus's right arm and the clipping (owner feedback)

- Marcus's right arm: `skater_anim_v3.py` keyed his right elbow at 84 degrees with half the swing of the left arm ("like a drum stick"). In the game it read as a stiff arm. In the push and the coast, the right arm is now the mirror of the left arm half a clip later (the arms swing in opposition). Right elbow range: push 70..89 -> 12..39 degrees, coast 76..83 -> 21..30 degrees (left: 9..35 and 17..27). The brake and the carves keep their deliberate asymmetric arm shapes.
- Clipping: `scripts/blender/skater_clip_probe.py` models each limb as a capsule, each knee (with its knee pad) as a sphere, and each skate as a box. Thigh against thigh is not a pair, because the inner thighs touch. The pass moves a skate in the ground plane when a leg goes into the other leg, and swings an upper arm away from a thigh when a hand or forearm goes more than 2 cm into it. Then it shifts the hips so that the centre of mass is where it was before the fix, and measures again. The mirrored carve gets the same fix. Close-ups before and after: `compare/closeup-*.jpg` (Cycles renders).

Deepest clip for each clip (capsule depth; up to about 2.5 cm is cloth contact with the baggy pants):

| Clip | Before (main) | After |
|---|---|---|
| Nia push | l_hand>l_thigh 11.9 cm (4 pairs) | r_forearm>r_thigh 2.3 cm (4 pairs) |
| Nia coast | l_forearm>l_thigh 4.9 cm (4 pairs) | l_forearm>l_thigh 2.2 cm (2 pairs) |
| Nia carve_left | r_forearm>r_thigh 11.0 cm (3 pairs) | r_forearm>r_thigh 2.4 cm (1 pairs) |
| Nia carve_right | l_forearm>l_thigh 11.8 cm (3 pairs) | l_forearm>l_thigh 1.9 cm (1 pairs) |
| Marcus push | l_hand>l_thigh 4.7 cm (1 pairs) | r_hand>r_thigh 1.9 cm (2 pairs) |
| Marcus coast | none over 1 cm | none over 1 cm |
| Marcus carve_left | l_skate>r_skate 5.6 cm (1 pairs) | none over 1 cm |
| Marcus carve_right | l_skate>r_skate 11.1 cm (3 pairs) | none over 1 cm |

## Arm IK with hand targets (owner request)

`skater_physics_pass.py` has a two-bone arm IK (shoulder, elbow, wrist). The elbow stays in its own bend plane, and the hand keeps its local rotation, so it follows the forearm. A hand target is a point for the palm (the middle of the wrist and the middle-finger knuckle), with a weight.

- Grab (`air_mute`, `air_japan`, `air_liukang`): the palm goes to the nearest point of the grabbed skate (the skate box, which includes the boot), one hand radius off its surface, on every frame. A grab is a meeting: when the skate is out of arm's reach, the leg IK brings the skate toward the hand (the foot is free in the air), but only as far as the leg stays inside the joint LIMITS; the rest is a chest bend toward the skate (Spine1 and Spine2, up to 30 degrees, inside the spine LIMITS). The arm IK closes the last gap.
- Clap (`dance_prep`): one clap per beat, at the frame where the palms are closest in that beat (a held pose between the claps is not a clap). At each clap the palms meet at their midpoint, the thickness of two palms apart, with a 4-frame blend on each side.
- Marcus's air clips and dances are the mirror of Nia's (`marcus_style`), so his grabs use the other hand and the other skate.

These four clips get only the IK layer: no balance, stance, or recoil.

| Clip | Target | Palm to target, max (before -> after) | Help from the body | Joints |
|---|---|---|---|---|
| Nia air_mute | left hand on r skate | 23.4 -> 0.0 cm | skate to hand 19 cm, chest bend 7 deg | PASS |
| Nia air_japan | left hand on r skate | 6.9 -> 0.5 cm | skate to hand 7 cm, chest bend 6 deg | PASS |
| Nia air_liukang | left hand on l skate | 5.4 -> 0.0 cm | skate to hand 6 cm, chest bend 4 deg | PASS |
| Nia dance_prep | clap (frames [0, 24]) | 1.0 -> 0.0 cm | - | PASS |
| Marcus air_mute | right hand on l skate | 27.7 -> 1.0 cm | skate to hand 16 cm, chest bend 28 deg | PASS |
| Marcus air_japan | right hand on l skate | 31.5 -> 0.8 cm | skate to hand 19 cm, chest bend 30 deg | PASS |
| Marcus air_liukang | right hand on r skate | 2.8 -> 0.0 cm | skate to hand 3 cm, chest bend 3 deg | PASS |
| Marcus dance_prep | clap (frames [0, 24]) | 7.8 -> 0.1 cm | - | PASS |

Videos: `videos/<skater>-hands-before-after[-half-speed].mp4` (the four clips, three-quarter and front views). Close-ups: `compare/closeup-<skater>-grab-<trick>.jpg`, `compare/<skater>-clap.jpg`.

## Files

- `videos/<skater>-before-after.mp4` and `videos/<skater>-before-after-half-speed.mp4`: before (`main`) on the left, after on the right, three-quarter view on top and side view below. The clips are push, coast, carve_left, and carve_right; the short clips play two times. Made with `scripts/skater-clip-frames.mjs` (one PNG for each 30 fps frame from `skater.html`) and ffmpeg (`xstack`, then `setpts=2*PTS` for half speed).
- `compare/<skater>-<clip>.jpg`: before (`main`) and after, at t = 0, 1/3, and 2/3 of the clip, from the three-quarter view and the left view. Made with `scripts/skater-clip-shots.mjs` from `skater.html?skater=<skater>` in headless Chromium.
- `compare/<skater>-push-recoil.jpg`: 8 frames around the end of one push stroke, before and after. These frames show the recoil.
- `before.json`, `after.json`: the lowest skinned vertex at each 30 fps frame in the browser (the ground is y = 0), and the console errors (0).
- `<skater>-metrics.json`: the Blender measures before and after, the recoil events, the joint-limit results, and the settings.
- `<skater>-clip-probe-before.json`, `<skater>-clip-probe-after.json`: the clip probe on the `main` GLB and on the new GLB.
- `<skater>-joint-limits.json`: the joint-limit gate on every clip of the new GLB.

## Measures (before = main -> after)

ZMP excess: the mean distance (m) of the zero moment point outside the support polygon of the skates on the ground. 0 = balanced on all frames. CoM jerk: the RMS of the third derivative of the centre of mass (m/s^3). The recoil adds a bounce, so it adds jerk on purpose.

| Clip | ZMP excess mean (m) | CoM vertical accel (m/s^2) | CoM jerk RMS | Lowest wheel, browser (m) | Joint limits |
|---|---|---|---|---|---|
| Nia push | 0.088 -> 0.001 | -8.7..2.5 -> -2.3..2.3 | 44 -> 38 | -0.000 -> 0.000 | PASS -> PASS |
| Nia coast | 0.000 -> 0.000 | -0.2..0.3 -> -0.9..1.5 | 4 -> 23 | -0.000 -> -0.000 | PASS -> PASS |
| Nia carve_left | 0.154 -> 0.040 | -9.8..7.7 -> -3.9..5.5 | 58 -> 51 | -0.039 -> -0.000 | PASS -> PASS |
| Nia carve_right | 0.148 -> 0.052 | -9.8..7.7 -> -3.9..5.5 | 58 -> 51 | -0.040 -> -0.001 | PASS -> PASS |
| Marcus push | 0.129 -> 0.000 | -12.0..3.6 -> -3.3..2.8 | 69 -> 40 | -0.000 -> 0.000 | PASS -> PASS |
| Marcus coast | 0.000 -> 0.000 | -0.4..0.6 -> -0.7..1.8 | 16 -> 25 | -0.000 -> 0.000 | PASS -> PASS |
| Marcus carve_left | 0.133 -> 0.001 | -6.3..7.1 -> -6.0..9.1 | 85 -> 86 | -0.000 -> 0.000 | PASS -> PASS |
| Marcus carve_right | 0.125 -> 0.011 | -6.2..7.0 -> -6.0..8.9 | 85 -> 87 | -0.000 -> -0.000 | PASS -> PASS |

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

- Nia carve: beat 2 is fixed (see above), but beat 1& (frames 10 to 13, both skates down) is still out of balance by up to 0.19 m, and the touch-down frame by 0.21 m. A real skater must review the corner step.
- Marcus carve: the step landings now have a recoil, and the upward CoM acceleration peak went from 7.1 to 9.1 m/s^2 (0.93 g). The jerk is the same as on `main` (85 -> 86). Look at it in the game.
- Push: the drive is twice as fast, but the game moves the skater at the speed of the sim, not of the clip. If the push impulse of the sim does not come at the drive, the feet and the speed do not agree. Look at it in the game.
- Coast: the stance is now low and leaning, and the recoil on each downbeat adds a small bounce. The jerk is higher than on `main` (Nia 4 -> 23). A person must decide if it feels better.
- Stance: the lean of Nia (34 degrees) is more than the lean of Marcus (24 degrees), because the rule puts the shoulders over the knees and the two rigs have different proportions and knee angles. The game references (Jet Set Radio, Bomb Rush Cyberfunk) were not measured: no written analysis of their skate poses was found, and video was not watched in this session. Hi-Fi Rush has no roller skating; its lesson is rhythm (the end of each action lands on the beat).
- The recoil is small: 1.1 to 1.4 cm of pelvis after the balance solve, 2.5 to 5 degrees of chest. A person must look at it at game speed.
