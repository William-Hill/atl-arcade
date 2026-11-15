# #290: a wider base stance (before and after)

Each page shows the contact sheet of a clip on `main` at `2d8056a` ("before") above the new contact sheet ("after"). The sheets come from `e2e/skater-anim.spec.js` (6 frames per clip, three-quarter view). The full sheets are in `assets/skaters/<name>/clips/`.

- `nia-ride-before-after.jpg`, `marcus-ride-before-after.jpg`: idle, push, coast, ride_back, carve_left, carve_right.
- `nia-dances-before-after.jpg`, `marcus-dances-before-after.jpg`: the 8 dances.

## What changed

1. `ride()` and `glide()` put the skates 0.33 m apart (`STANCE_X = 0.165`). Before, `ride()` put them 0.18 m apart and `glide()` 0.24 m apart. The hips go 0.03 m lower (`RIDE_Z = -0.14`).
2. The IK pole angle is calibrated for each rig (`calibrate_pole()`). The old angle 0 turned the knees of Nia in and the knees of Marcus out. Now the knee of each rig is in the plane through the hip, the ankle, and the pole target. The angles: Nia -5.1 and +7.4 degrees, Marcus +17.8 and -17.8 degrees.
3. A new pose key `knees` moves the pole targets out to the sides. `ride()` and the ATL Ryde (`coast`) use 0.10 m (`KNEES_OUT`), so the knees point over the toes.

## Measurements

`scripts/blender/clip_metrics.py` keys each clip and measures every 2nd frame. "Knee mesh gap" is the smallest distance between the leg mesh within 0.10 m of the left knee joint and the leg mesh within 0.10 m of the right knee joint. "Lowest skate z" is the lowest point of the skate meshes. The negative values in push and the carves are the skate edge tilt in those keys; they are the same as before (push -2.1 cm, carve -3.5 cm on `main` for Nia).

Nia

| Clip | Knee mesh gap before (cm) | After (cm) | Lowest skate z after (cm) |
|---|---|---|---|
| idle | 5.8 | 9.2 | -0.2 to -0.2 |
| push | 2.4 | 6.6 | -2.0 to -0.2 |
| coast | 0.3 | 7.7 | -0.2 to +0.1 |
| ride_back | 1.1 | 8.4 | -0.2 to -0.2 |
| carve_left | 4.8 | 9.2 | -3.5 to +0.1 |
| carve_right | 5.0 | 9.4 | -3.4 to +0.1 |
| dance_bankhead | 3.2 | 16.0 | -0.2 to -0.2 |
| dance_walkitout | 5.3 | 16.5 | -0.2 to -0.2 |
| dance_prep | 0.1 | 9.1 | -0.2 to -0.1 |
| dance_swagsurf | 5.0 | 13.4 | -0.2 to -0.1 |
| dance_snaplean | 2.9 | 14.0 | -0.2 to -0.2 |
| dance_crisscross | 0.3 | 7.4 | -0.2 to -0.1 |
| dance_spin | 0.7 | 9.6 | +1.6 to +1.6 (on the toe stops) |
| dance_sitspin | 16.4 | 26.4 | +0.0 to +0.1 |

Marcus (before: the knees turned out, so the gap was large, but the knees were not over the toes)

| Clip | Knee mesh gap before (cm) | After (cm) | Lowest skate z after (cm) |
|---|---|---|---|
| idle | 21.2 | 12.7 | -0.0 to -0.0 |
| push | 24.2 | 11.1 | -2.9 to -0.0 |
| coast | 15.7 | 10.1 | -0.1 to +0.3 |
| ride_back | 16.9 | 12.4 | -0.0 to -0.0 |
| carve_left | 27.1 | 12.5 | -4.3 to +0.2 |
| carve_right | 27.0 | 12.6 | -4.2 to +0.1 |
| dance_bankhead | 23.8 | 20.9 | -0.0 to -0.0 |
| dance_walkitout | 28.6 | 21.9 | -0.0 to -0.0 |
| dance_prep | 17.9 | 12.6 | -0.0 to +0.0 |
| dance_swagsurf | 21.3 | 17.4 | -0.0 to -0.0 |
| dance_snaplean | 20.4 | 18.2 | -0.0 to -0.0 |
| dance_crisscross | 14.7 | 9.7 | -0.0 to -0.0 |
| dance_spin | 19.4 | 13.9 | +0.9 to +0.9 (on the toe stops) |
| dance_sitspin | 28.6 | 34.7 | -0.0 to +0.0 |

Not in scope: `grind_unity` crosses the legs on purpose, so its knees touch (0.3 cm for Nia). The grinds do not use `ride()`.
