# Arm pass: loose arms, and no backswing through the body (#323, 2026-11-22)

Owner feedback after #313: Nia's arms are too stiff while she skates, and on the backswing her arms go through her body. This pass changes Nia's `push`, `coast`, `carve_left`, and `carve_right` (and re-exports the four hand IK clips of #313 with no change in their numbers). A second step (see "Marcus" below) gives Marcus's `push` and `coast` the same loose-arm layer.

## What was wrong

1. The probe did not see the fault. `skater_clip_probe.py` tested the hands against the torso only. The torso capsule stopped at the `Hips` joint, so the hips and the seat of the baggy pants were not in it. Close renders (`compare/closeup-nia-push-back-left.jpg`, top row, frame 42) show the left hand and forearm in the hip on the backswing.
2. The #313 thigh fix made the arm jump. It turned the upper arm away from a thigh about a new axis on each frame, and about a default (fore-aft) axis on the frames next to a clip. The upper arm jumped up to 30 degrees in one frame (for example push frame 23 to 24), and the forearm went through the hip in that frame. The angular jerk of the hands in the push was 1470 to 1526 rad/s^3. In the carve, the same fix put the arm 8 to 9 cm into the jacket.
3. The arms were stiff: elbow range 33 degrees in the push and 12.5 degrees in the coast.

## The probe (`scripts/blender/skater_clip_probe.py`)

- New pairs: `l_forearm>torso`, `r_forearm>torso`, `l_uparm>torso`, `r_uparm>torso` (`LeftArm`/`RightArm` to `LeftForeArm`/`RightForeArm`).
- The torso radius comes from the mesh and changes with the direction: 16 directions around the `Hips` to `Spine2` axis, in four bands (the pelvis below the `Hips` joint, Hips, Spine, Spine1), each in the frame of its bone. Each value is the median distance of the jacket (or pants) vertices in that band and direction. One radius was wrong: the jacket is 17 to 19 cm wide at each side of the chest, but 9 to 12 cm deep at the front and the back.
- The pelvis band has the hips and the seat of the pants: the top 30% of each thigh, which the thigh capsules do not cover.
- The upper-arm capsule covers the elbow end only (the last 25%), with the 30th percentile radius (the arm in the puffy sleeve). On Nia the shoulder joint is 12 cm from the mid line, and the jacket is 19 cm wide at each side of the chest. So the upper half of a hanging sleeve is always in the jacket: cloth on cloth, the same orange. With the whole upper arm and the median radius, a relaxed arm hanging 30 degrees out from the body read as 5 cm deep, and every frame of every clip failed.
- The old single `torso` radius in `radii_m` is not used for the torso pairs.

## The pass (`scripts/blender/skater_physics_pass.py`)

ARM_LOOSE (Nia `push` and `coast`), in the frame of the chest, for each arm:

- Elbow: 8 degrees (coast 10) more bend, plus up to 18 degrees (coast 14) more at the front of the swing. A running arm bends in front and opens behind.
- Follow-through: on the backswing, the forearm keeps 60% of the turn of the upper arm since 2 frames before (up to 14 degrees in the push, 10 in the coast).
- Wrist lag: the hand keeps 50% of the turn of the forearm since 1 frame before (up to 10 degrees; 5.1 degrees used in the push, 1.0 in the coast). The signed turn uses the right-handed order (fwd, side, up) of the chest frame. The first version used (side, fwd, up), which is left-handed, and the wrist went with the turn (review of #332).
- Out at the back: from 5 to 35 degrees behind the chest, the upper arm swings out from the body by up to 12 degrees (coast 10).
- The swing timing does not change, so the arms stay in opposition to the legs.

The clip fix: an arm in the torso, a thigh, or a knee now swings out from the body (abduction) about the forward axis of the chest. The axis is the same on every frame, so the fix is smooth in time. A torso pair must be under 0 cm (TORSO_CLIP -0.3 cm, with a 0.5 cm gap); a thigh or knee pair keeps the 2 cm cloth allowance of #313. The rebalance after the fix moves the hips, so the fix, the rebalance, and the probe run up to 3 times (FIX_ROUNDS). The total swing-out of all rounds is at most 45 degrees (ARM_OUT_MAX) on each frame. The largest is 35.3 degrees, on the right arm in `carve_left` (the left arm in `carve_right`).

## Results

Deepest arm-to-torso depth (before = the shipped GLB after #313; the new probe on both):

| Clip | Before | After |
|---|---|---|
| Nia push | r_uparm>torso 6.7 cm (23 frames over 1 cm) | l_uparm>torso 0.8 cm (0 frames) |
| Nia coast | r_forearm>torso 6.9 cm (48 frames) | r_uparm>torso 0.4 cm (0 frames) |
| Nia carve_left | r_uparm>torso 8.7 cm (44 frames) | none over 0 cm |
| Nia carve_right | l_uparm>torso 8.1 cm (45 frames) | none over 0 cm |
| Nia brake | none over 1 cm | none over 1 cm (no change) |
| Marcus, all 5 clips | none over 1 cm | none over 1 cm (see "Marcus") |

Elbow bend (degrees, min..max, range; both arms have the same range):

| Clip | Before | After |
|---|---|---|
| push | L 16.7..49.7, R 14.1..47.2 (range 33.1) | L 24.7..79.4, R 22.1..76.8 (range 54.7) |
| coast | L 27.0..39.5, R 24.4..36.9 (range 12.5) | L 37.0..63.6, R 34.4..61.0 (range 26.6) |

Other measures (before -> after):

| Clip | ZMP excess mean (m) | CoM jerk RMS | Hand angular jerk RMS L, R | Deepest thigh or knee pair |
|---|---|---|---|---|
| push | 0.001 -> 0.000 | 37.3 -> 37.6 | 1470, 1526 -> 468, 463 | 2.6 -> 1.9 cm |
| coast | 0.000 -> 0.000 | 22.6 -> 22.6 | 132, 126 -> 231, 126 | 2.2 -> under 1 cm |
| carve_left | 0.040 -> 0.036 | 48.2 -> 43.3 | 122, 1275 -> 122, 179 | 1.9 -> 2.4 cm (r_hand>r_knee) |
| carve_right | 0.052 -> 0.050 | 53.6 -> 49.2 | 1400, 122 -> 188, 122 | 2.4 -> 2.2 cm |

The joint-limit gate passes on all 26 clips with no WARN (`nia-joint-limits.json`). No wheel goes into the ground (lowest wheel -0.000 m; carve_right -0.002 m as in #313). The recoil events and the push drive frames are the same as in #313 (`nia-metrics.json`).

## What did not improve, and what is not verified

- The upper-arm pair is calibrated (the elbow end, the arm inside the sleeve). The upper half of the sleeve still goes into the side of the jacket on most frames. It is cloth on cloth of the same color, and the renders do not show it, but the probe does not measure it.
- In the carve, the hand now rests on the knee pad (r_hand>r_knee 2.4 cm on 41 frames, up from under 1 cm). This is cloth contact under the 2.5 cm level of #313, but it is a new contact. Look at it in the game.
- The angular jerk of the left hand in the coast goes up (132 -> 231). The wrist lag is at most 1.0 degree in the coast, so the cause is the elbow and the swing-out, not the wrist.
- Not done: a check in the game at full speed, and the owner approval. These are acceptance criteria of #323.

## Marcus

Marcus had no arm in the torso (no torso pair over 1 cm in the 5 clips). The owner looked at him and said that his arms look stiff too. So `ARM_LOOSE` has a `marcus` entry with the same settings as Nia. It runs after the arm mirror of #313, so his arms stay in opposition.

Elbow bend (degrees):

| Clip | Before (#313) | After |
|---|---|---|
| push | L 8.7..35.3, R 12.2..38.8 (range 26.6) | L 16.7..63.3, R 20.2..66.8 (range 46.6) |
| coast | L 17.1..26.8, R 20.6..30.3 (range 9.7) | L 27.1..51.0, R 30.6..54.5 (range 23.9) |

Other measures (before -> after):

| Clip | ZMP excess mean (m) | CoM jerk RMS | Hand angular jerk RMS L, R | Deepest arm pair |
|---|---|---|---|---|
| push | 0.0004 -> 0.0005 | 39.3 -> 39.3 | 494, 357 -> 597, 570 | l_hand>l_knee 2.1 cm (cloth contact) |
| coast | 0.000 -> 0.000 | 24.8 -> 24.8 | 148, 147 -> 256, 249 | r_hand>r_thigh 1.1 cm |
| carve_left, carve_right | same as #313 | same as #313 | same as #313 | none over 1 cm |

- No arm capsule goes more than 1 cm into the torso in push, coast, carve_left, carve_right, or brake.
- The joint-limit gate passes on every clip, with one WARN that was already on `main`: `dance_drumline`, left knee 30.9 degrees off its hinge (limit 30).
- The push drive frames and the recoil events are the same as in #313.
- The wrist lag and the follow-through add hand angular jerk (push about 20 to 60% more, coast about 70% more). The hands move more; this is the purpose of the layer, but look at it in the game.
- In the push, from behind, the right hand swings across behind the back (frame 14). This was also in #313. The probe shows no contact there.

Files: `videos/marcus-arms-before-after[-half-speed].mp4` (push 2 times, coast 2 times, carve_left 2 times, carve_right 2 times), `compare/closeup-marcus-push-backleft.jpg`, `compare/closeup-marcus-push-front.jpg` (push frames 6, 14, 28, 36), `compare/closeup-marcus-coast.jpg` (coast frames 12 and 36), `marcus-elbow-ranges.json`, `marcus-metrics.json`, `marcus-joint-limits.json`.

## Files

- `videos/nia-arms-before-after.mp4`, `videos/nia-arms-before-after-half-speed.mp4`: before (#313) on the left, after on the right; three-quarter view on top, left view below. Clips: push (2 times), coast, carve_left (2 times), carve_right (2 times). Made with `scripts/skater-clip-frames.mjs` and ffmpeg (`xstack`, then `setpts=2*PTS`).
- `compare/closeup-nia-push-back-left.jpg`, `compare/closeup-nia-push-front.jpg`: push frames 8, 16, 24, 42; top row before, bottom row after (Blender Workbench).
- `compare/closeup-nia-carve-coast.jpg`: carve_left frames 12 (front, back right) and 30, coast frame 30 (front, back left); top before, bottom after.
- `nia-clip-probe-before.json`, `nia-clip-probe-after.json`: the new probe on the #313 GLB and on the new GLB. The open lower limit of the pelvis band is `null` in `torso_table_m.bands`. `marcus-clip-probe-before.json`, `marcus-clip-probe-after.json`: the same for Marcus.
- `nia-elbow-ranges.json`: the elbow ranges above.
- `nia-metrics.json`: the pass report (the source is the GLB before #313, as in #313). `nia-joint-limits.json`: the gate on every clip of the new GLB.

Run:

```bash
git show 5b1d2412^:assets/skaters/nia/skater.glb > /tmp/nia-pre313.glb
```

```bash
blender -b --factory-startup --python-exit-code 1 -P scripts/blender/skater_physics_pass.py -- --in /tmp/nia-pre313.glb --out assets/skaters/nia/raw/arms
```

```bash
node scripts/assets/graft-clips.mjs assets/skaters/nia/skater.glb assets/skaters/nia/raw/arms/nia-physics.glb assets/skaters/nia/skater.glb
```

```bash
node scripts/assets/graft-clips.mjs assets/skaters/nia/skater-1024.glb assets/skaters/nia/raw/arms/nia-physics.glb assets/skaters/nia/skater-1024.glb
```
