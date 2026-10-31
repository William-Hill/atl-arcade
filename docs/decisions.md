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
