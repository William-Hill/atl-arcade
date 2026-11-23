# Loop seam fix for Nia's dance_walkitout (2026-11-22)

## Result

- `dance_walkitout` had a loop seam of 1.368 m/s: the arms snapped once in each loop, from frame 47 to frame 0. After the fix, the seam is 0.577 m/s.
- The jitter went from 11.89 to 5.12 m/s². The clip length (48 frames, 1.6 s) and the beat timing did not change.
- The other 22 looping clips of Nia did not change. Their metrics are the same before and after.
- Marcus did not change. His clips were not measured in this pass.

## Method

1. `scripts/blender/skater_loop_smooth.py` reads `dance_walkitout` from the shipped `skater.glb` at 30 fps. It applies a circular Gaussian filter (sigma 0.08 s, 2.4 frames) to the local bone rotations and the hips location. The filter is circular, so the first frame and the last frame stay equal.
2. `scripts/assets/graft-clips.mjs` puts the new clip into `skater.glb` and `skater-1024.glb`. It replaces only this clip and keeps the #187 encoding.

The filter and the metrics come from the GVHMR mocap test (PR #316, `docs/research/2026-11-21-gvhmr-mocap-test.md`). The metrics come from `scripts/mocap/nia_clip_audit.py` on that branch.

## Choice of sigma

| Sigma (s) | Seam (m/s) | Jitter (m/s²) | Lowest wheel (cm) |
|---|---|---|---|
| 0 (shipped) | 1.368 | 11.89 | −0.01 |
| 0.0625 | 0.766 | 6.53 | −0.14 |
| **0.08** | **0.577** | **5.12** | −0.17 |
| 0.1 | 0.405 | 3.92 | −0.18 |

A larger sigma gives a lower seam, but it also softens the hits of the dance. 0.08 s puts the seam in the range of the other dance clips (0.33 to 0.45 m/s for `dance_crisscross`, `dance_snaplean` and `dance_bankhead`), and the key poses stay the same.

`push` was not filtered. #313 already lowered its seam to 0.236 m/s, and its fast drive and recoil are deliberate.

## Playtest

- `walkitout-before-after.mp4` and `walkitout-before-after-half-speed.mp4`: before on the left, after on the right. The top row is the three-quarter view and the bottom row is the front view. The loop plays 4 times, so the seam shows 3 times. Frames from `skater.html` in headless Chromium, one per 1/30 s.
- `walkitout-seam.jpg`: front view, frames 44 to 47 and then 0 to 3. The top row is before and the bottom row is after. Before, the arms jump between frame 47 and frame 0. After, the same move spreads over frames 46 to 1.
- `game-walkitout.jpg`: Nia plays Walk It Out in the game (BeltLine Eastside, the pbr look), from a scripted ride: push, groove (Bankhead Bounce), push, groove (Walk It Out). The probe found the clip and 0 page errors.
- The headless game ran at a low frame rate (SwiftShader), so it does not show the seam at game speed. A person must look at the dance in the game at full speed.

## Tests

- `npx playwright test e2e/skater-model.spec.js e2e/skater-anim.spec.js e2e/skater-moves.spec.js`: 14 of 14 passed.
- `npx vitest run`: 2016 of 2017 passed. The failure is a 5000 ms timeout in `src/level/geo/facade-kit.test.js`. That test also times out on `main`.
