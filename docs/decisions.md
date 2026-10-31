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

## 2026-10-31 — Rapier 0.21.0, and what owns collision (M0-02)

`@dimforge/rapier3d-compat` 0.21.0, published 2026-09-25. The `-compat` build inlines its WASM, so Vite needs no extra plugin and the same module runs in Node for tests.

Two things touch the level surface, and they have separate jobs:

- **Rapier owns the world.** Every level object becomes one or more fixed colliders: a cuboid per box, a cuboid per stair tread, a capsule per rail segment, and a trimesh for the quarter-pipe. Rapier draws the debug overlay and will serve the camera occlusion raycast in M0-04.
- **A pure analytic probe will own the surface under the skater** (M0-03). The skate controller is a pure module with no Rapier import, so it stays deterministic and runnable in Vitest.

The risk is two sources of truth drifting apart. The guard is that both read the same level data, and composite shapes are decomposed once in `src/sim/level/parts.js` and `src/sim/level/extrude.js` — so the ramp you see, the ramp Rapier owns, and the ramp the probe samples are built from the same numbers.

Level data is plain JavaScript in `src/levels/`, validated by `validateLevel` at import time, so a bad level fails loudly on load rather than silently rendering half a block.

Curbs are not grindable yet. They are 22 cm tall and run the length of the block, so they would swamp the rail snap test before it has been tuned.

## 2026-10-31 — Skate controller shape and first tuning (M0-03)

The controller is a pure module: `step(state, input, dt, world)` in, next state out. No Three.js, no Rapier, no DOM, no clock. `world` is just `{ probe, spawn, tuning }`, so Vitest can run it on an endless flat floor and the browser can run it on the greybox block, with the same code.

Decisions inside it:

- **Roller skates grip.** The skater travels where they face. There is no drift model. Carving turns the facing and the velocity follows. If a slide is wanted later it becomes a separate state, not a change to this rule.
- **Speed only comes from a push**, and a push has a cooldown. Coasting decays slowly. This is the "momentum is king" pillar in numbers.
- **Carving tightens as you slow.** `carveRateAt` eases from 3.2 rad/s at a standstill to 1.05 rad/s at top speed, so a fast line is a committed line.
- **A jump is a fixed arc.** No charge, no variable height. The spec asked for a fixed arc and it keeps the air state simple for the grind work in M0-05.
- **Nothing in the controller ends a run** (pillar 1). Roll off the block and you are put back at the spawn with a counter incremented. There is no death, no reset of score, and no fail state.

The push impulse is 2.2 m/s, not the 3.4 it started at: against an 11 m/s cap, 3.4 meant three pushes maxed the skater out and speed stopped being a decision. At 2.2 it takes five or six.

Top speed is 11 m/s, not the 14 it started at. At 14 the skater crossed the whole greybox block in under three seconds and a four-second scripted line ran out of block. 11 m/s is about 40 km/h, which is quick for roller skates and leaves the block readable. The greybox ground grew from 64 x 40 m to 90 x 56 m at the same time, so a full-lock carve (radius about 10.5 m at top speed) fits on it with room to spare.

Determinism is checked two ways: Vitest runs a script and compares two runs, and the Playwright spec runs the same script in Node and in the browser and compares end positions to the millimetre. The browser result is also compared frame-driven against batch-run, which is what proves the fixed-step accumulator is doing its job.
