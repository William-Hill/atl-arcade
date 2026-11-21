# Physics pass on push, coast, and carve (2026-11-21)

`scripts/blender/skater_physics_pass.py` changed these clips in headless Blender 5.2.3: `push`, `coast`, `carve_left`, and `carve_right` (the mirror of the new `carve_left`). It did this for Nia and for Marcus. Cascadeur did not run in the cloud container (see `docs/decisions.md`, 2026-11-21).

## Files

- `compare/<skater>-<clip>.jpg`: before (top) and after (below) at t = 0, 1/3, and 2/3 of the clip, from the three-quarter view and the left view. Made with `scripts/skater-clip-shots.mjs` from `skater.html?skater=<skater>` in headless Chromium.
- `before.json`, `after.json`: the lowest skinned vertex at each 30 fps frame in the browser (the ground is y = 0), and the console errors (0).
- `<skater>-metrics.json`: the Blender measures before and after for each clip, and the settings.

## Measures (before -> after)

ZMP excess: the mean distance (m) of the zero moment point outside the support polygon of the skates on the ground. 0 = balanced on all frames. CoM jerk: the RMS of the third derivative of the centre of mass (m/s^3). Lower = smoother.

| Clip | ZMP excess mean | CoM vertical accel (m/s^2) | CoM jerk RMS | Lowest wheel (browser) |
|---|---|---|---|---|
| Nia push | 0.088 -> 0.001 | -8.7..2.5 -> -3.3..1.1 | 44 -> 21 | 0.0 -> 0.0 |
| Nia coast | 0 -> 0 | -0.21..0.26 -> -0.09..0.10 | 4.3 -> 0.7 | 0.0 -> 0.0 |
| Nia carve_left | 0.154 -> 0.071 | -9.8..7.7 -> -4.4..3.6 | 58 -> 32 | -0.039 -> 0.0 |
| Nia carve_right | 0.148 -> 0.074 | -9.8..7.7 -> -4.4..3.6 | 58 -> 32 | -0.040 -> -0.001 |
| Marcus push | 0.129 -> 0.048 | -12.0..3.6 -> -4.4..1.4 | 69 -> 42 | 0.0 -> 0.0 |
| Marcus coast | 0 -> 0 | -0.40..0.60 -> -0.38..0.45 | 16 -> 3.6 | 0.0 -> 0.0 |
| Marcus carve_left | 0.133 -> 0.002 | -6.3..7.1 -> -4.3..5.1 | 85 -> 47 | 0.0 -> 0.0 |
| Marcus carve_right | 0.125 -> 0.005 | -6.2..7.0 -> -4.2..4.9 | 85 -> 47 | 0.0 -> 0.0 |

The clip lengths (frames at 30 fps) do not change: Nia push 52, coast 96, carves 48; Marcus push 44, coast 48, carves 48. All clips loop with no error and have no root travel.

## What did not improve

- Nia carve: on beat 2 the right skate lifts for 13 frames. Nia then stands on the left skate only, and that skate drags 10 to 27 cm behind her centre of mass. The pass cannot fix this with a hips shift of 6 cm or less. The step or the drag must change. A real skater must review this.
- Marcus push: the ZMP is still outside the support on 25 of 44 frames (mean 4.8 cm, was 12.9 cm).
- Coast: the arms move less (hand jerk Nia 34 -> 7). The clip is smoother, but it can look less lively. A person must look at it in the game.
