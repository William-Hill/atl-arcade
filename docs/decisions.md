# Decisions

## 2026-10-30 — Engine and starting point

Phaser 4.2.1 with Vite 8.3.5. Godot 4 web export rejected (heavier build, single-threaded on iOS Safari). PixiJS rejected (renderer only). True 3D rejected on art cost. The pseudo-3D road pattern comes from the RenderATL Rush `sim/road3d.js` approach (own code, rewritten here). No code copied from `yonifra/outrun2026` (no license).

## 2026-10-30 — Repo shape

One repo, one Phaser shell, many game modes: Skate ATL first, Atlanta Tycoon second. Production code lives under `src/` when it exists. `prototypes/` is throwaway.

## 2026-10-30 — Pivot to free skate in 3D, Three.js

The beat-lock prototype answered the wrong question. The vision is free skating in 3D (Tony Hawk's Pro Skater meets Jet Set Radio) with dance and style on the move. Phaser cannot do this. Three.js chosen over Godot 4 because: the game must live in the browser on the site; the neighborhood pipeline (geodata to geometry) is JavaScript end to end; the Rush `codex/196-3d-spike` already proves AutoSprite/Meshy GLB to Three.js with animation; and agents, not humans, build the levels, so the Godot editor advantage does not apply. The Phaser scaffold at the repo root stays until the Three.js shell replaces it.

## 2026-10-30 — Three.js shell versions (M0-01)

The Phaser scaffold is replaced by a Three.js + Vite shell at the repo root. Versions, all published at least 7 days before today:

| Package | Version | Published |
|---|---|---|
| three | 0.186.1 | 2026-09-24 |
| vite | 8.3.5 | 2026-10-21 |
| vitest | 5.0.5 | 2026-10-15 |
| @playwright/test | 1.63.0 | 2026-09-04 |

`three` 0.187.0 was published 2026-10-30 and is too new under the 7-day rule. `@playwright/test` is pinned to 1.63.0 because that is the version whose browser build is preinstalled in the agent container, so headless runs need no browser download.

Phaser is removed from `package.json`. The beat-lock prototype files stay on disk untouched as history, but they are no longer a Vite build input, because they import Phaser and nothing may depend on Phaser now. The prototype is not runnable from this repo any more; its findings live in `prototypes/beat-lock-concept/PIVOT-NOTE.md`.

Layout: pure simulation under `src/sim/` with no Three.js imports, rendering under `src/render/`. Vitest covers `src/**/*.test.js`. Playwright tests live in `e2e/` and write evidence to `e2e/__screenshots__/`.

## 2026-10-30 — Greybox level as data, Rapier for static collision (M0-02)

The greybox block is a plain data module, `src/level/greybox.js`: every object has a `kind`, a center `position`, a `size` for boxes, and a grind `spline` on rails and ledges. Splines are a polyline (`points`) or a quadratic Bezier (`start`, `control`, `end`); `src/level/splines.js` samples both into polylines and does the nearest-point and arc-length math the grind system needs. The quarter pipe is a circular profile in `src/level/ramp.js`, which builds one triangle list that both the renderer and physics use.

Collision: `@dimforge/rapier3d-compat` 0.21.0 (published 2026-09-25). Boxes are cuboids, rails are one capsule per polyline segment, the ramp is a trimesh. Colliders carry collision groups (`ground`, `wall`, `rail`, `ledge`) so the character controller and camera rays can filter. A debug overlay draws `world.debugRender()`; toggle with `?debug=1` or the H key.

Ground height for the skate controller comes from a pure sampler, `src/level/ground.js`, not from Rapier. It returns the highest surface under (x, z) and its normal, so the controller stays testable in Vitest with no WASM. Rapier handles walls, the camera raycast, and the overlay. If the sampler and Rapier disagree, the sampler wins for the skater's feet.

The Rapier WASM is inlined into the main bundle by Vite (about 4.9 MB raw, 1.8 MB gzip). Acceptable for the greybox; split it before M1.

## 2026-10-30 — Skate controller model (M0-03)

The controller in `src/sim/skate/controller.js` is pure and runs at a fixed 60 Hz step. While rolling it keeps a scalar `speed` and a heading `yaw`; the 3D velocity is derived from the surface tangent under the heading. While airborne it keeps a free 3D velocity under arcade gravity. Ground comes from the pure sampler (`env.sampleGround`), so Vitest runs the whole model with no WASM. Every number lives in `src/sim/skate/constants.js` with min / typical / max comments.

Surface rules: a rise above `maxStep` (0.25 m) is a wall and stops the skater; a drop beyond `dropThreshold` (0.3 m) is an edge and the skater falls; gravity acts along the surface tangent so ramps slow the climb and speed the descent; a near-vertical lip (`launchNormalY`) launches the skater straight up, so a quarter pipe behaves like a THPS vert ramp. Landing projects the air velocity onto the surface. Rails are not solid to the rolling skater yet; the grind system (M0-05) owns rails.

Scripted input (`src/input/scripted.js`) plays `{ frames, input }` entries one per fixed tick. The same script runs through the pure module in node and through the game loop in the browser, and the Playwright test asserts the end positions agree within 1 cm.

## 2026-10-30 — Follow camera (M0-04)

The camera math is pure (`src/sim/camera.js`) and its knobs live in `CAMERA` in `src/sim/skate/constants.js`. The camera orbit yaw chases the skater yaw with exponential smoothing by the shortest turn, so a U-turn or the rollback flip on the quarter pipe swings the camera around in about half a second instead of snapping. The position and the look-at point chase their goals with their own rates. Distance grows with speed up to a cap, and the look-at point leads the skater by up to 3 m at full speed.

Wall clipping: each frame the renderer casts one Rapier ray from the look-at point toward the smoothed camera position, filtered to the `wall`, `ground`, and `ledge` groups (rails are ignored). On a hit the camera moves to the hit point minus a margin, never closer than `minDistance`. Rapier ray casts return nothing until the query pipeline is built, so the physics world runs `updateSceneQueries()` (or one `step()`) right after creation.

The default view is the follow camera. `?view=orbit` keeps the orbit camera for inspection, and `?view=fixed` is the screenshot reference pose.

## 2026-10-30 — Grind system (M0-05)

`src/sim/skate/grind.js` is pure. Rails and ledges are sampled into polylines once (`prepareGrindables`). A snap needs the grind button, a horizontal distance to the spline under `snapRadius` (1.2 m), the spline between 0.35 m below and 0.9 m above the feet, and a heading within 60 degrees of the tangent (`minAlongDot` 0.5). The snap picks the nearest candidate and rides in the direction of the heading. Both rolling and airborne approaches snap; a THPS-style jump-on is not required for the greybox.

Balance is a deterministic meter: a constant lean push (`balanceDrift`) plus growth proportional to the lean (`balanceGravity`), minus the steer input times `balanceCorrect`. The lean side comes from the steer at the snap, else it alternates per snap. Past `balanceLimit` the skater falls off the side it leans toward at half speed. A fall ends the combo, never the run. After any exit a short `resnapCooldown` stops an instant re-snap.

Exits: a jump adds the jump speed to the tangent velocity; the spline end launches with the tangent velocity plus a small upward pop. `src/sim/skate/skater.js` orchestrates rolling, air, and grind, and counts snaps, exits, falls, and grind time in `stats` for the playtest metrics. The Playwright free-skate loop writes `reports/m0-05-falls.json`.

## 2026-10-31 — Follow camera on the quarter pipe (M0-04 fix)

William's first play found camera faults on the quarter pipe. A node probe of the run showed four causes:

1. The look-at point led 2 m along the heading, which put it inside the ramp and deck while the skater climbed. The wall ray started there, hit at distance 0, and pulled the camera 12 m forward onto the ramp face in one frame.
2. When the ray cleared, the camera jumped 8 m back in one frame. The clip had no smoothing.
3. At the top the landing flips the skater yaw by 180 degrees, and the camera orbited through the side of the deck to follow it.
4. Back on flat ground the camera swung 180 degrees in about half a second, up to 0.93 m per frame.

Fixes: the look-ahead now leads only by the horizontal velocity along the camera heading, so it never points into a wall or back at the camera. The wall ray starts from a pivot one `lookHeight` off the surface along the ground normal. A new blocker snaps the camera in at once, and a cleared blocker lets it ease back out at `clipRelease`. While the ground normal y is under `vertNormalY` (0.9), on the transition or in the air above it, the camera holds its yaw and stays on the street side. The swing is capped at `maxYawRate` (3 rad/s). On the scripted quarter-pipe run the worst camera move is now 0.35 m per frame and the camera never comes closer than 7 m. The Playwright test fails on the old code with 218 off-screen samples.

## 2026-10-31 — Grind key and review fixes (M0-05)

Grind moves from Control to F. On Windows and Linux, Control plus W closes the tab, and Control plus S or D opens browser dialogs, so a held grind key could end the session. The keyboard now prevents the browser default for every bound key. The grind lean now tilts toward the side the skater falls off, and a grind tick clears the jump, landing, and wall flags that the snap tick set.
