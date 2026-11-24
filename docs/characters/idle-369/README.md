# Marcus idle: slower drum hits, no pop at the idle to coast fade (#369, 2026-11-24)

## What was wrong

Marcus's `idle` is his drum count (`marcus_idle()` in `scripts/blender/skater_anim_v3.py`): the forearms hit like drum sticks on each beat, and the right hand hits twice on beat 4. Each hit sprang back over 4 clip frames (30 degrees), and the second hit of beat 4 swung down 38 degrees in 4 clip frames. The game plays the clip at 1.333 times its speed (`grooveRate()` at 100 BPM). In the game, the right forearm turned up to 0.153 rad in one frame. Nia's idle turns no bone more than 0.022 rad in one frame.

At an idle -> coast change, the 0.3 s fade adds the pose gap between the two clips (up to 0.99 rad for the right forearm) on top of that turn. At some beat phases the worst frame was 0.170 to 0.174 rad. The limit of the pop check is 0.160 rad.

## The change

- The spring back after a hit takes 7 clip frames (was 4).
- On beat 4 the right forearm rests at 0.2 of a hit, and the second hit comes 20 frames into the beat (was 16), so it swings down over 8 frames (was 4).
- The hits stay on the beat. The toe-stop taps, the head nods, the stance, and the other clips do not change.

## Results

Fastest bone turn in one game frame (`node scripts/assets/clip-speed.mjs assets/skaters/marcus/skater.glb idle`):

| | before | after |
| --- | --- | --- |
| RightForeArm | 0.153 | 0.076 |
| LeftForeArm | 0.120 | 0.067 |
| RightLeg (toe-stop tap) | 0.033 | 0.054 |
| RightHand | 0.072 | 0.036 |

- Pop check (`e2e/skater-blend.spec.js`, `popCheck()` at 48 phases of the idle loop and 24 of the coast loop): before, Marcus failed at 0.173 rad (idle -> coast, RightForeArm). After, the worst change is the push at 0.137 rad (LeftLeg), and the idle -> coast change is less.
- Joint-limit gate (`scripts/blender/skater_joint_limits.py --clips idle`): PASS before and after (`joint-limits-before.json`, `joint-limits-after.json`).
- Clip probe (`scripts/blender/skater_clip_probe.py --clips idle`): no clip over 1 cm.
- A rebuild of the old script gave the shipped idle within 0.0004 rad (the int16 key encoding), so the source and the pipeline are the same as for the shipped clip.

## Evidence

- `marcus-idle-before-after.mp4` (game speed) and `marcus-idle-before-after-half-speed.mp4`: before on the left, after on the right, the skater viewer (`skater.html?skater=marcus`) at 60 fps clip time steps of 1.333 / 60 s.
- `idle-before-beat1.png`, `idle-after-beat1.png`: beat 1, 0 to 0.53 s. `idle-before-beat4.png`, `idle-after-beat4.png`: beat 4, 2.4 to 3.2 s.
- Art review: the owner approved the new idle on 2026-11-24.
