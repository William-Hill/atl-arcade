# Mobile playability audit (#65)

**Date:** 2026-11-03. **Build:** `audit-65-playability` at `90260bb`. No source change. **Auditor:** an agent. No real phone was used. **Skills applied by hand:** ux-review, perf-profile. Scripts are in `scripts/`. Data is in `probe.json`, `measurements.json`, `measurements-swiftshader.json`, `load.json`, and `touch.json`.

## Score

**Mobile playability: 1 / 5.** A phone player cannot skate. A tap starts the audio, and a drag turns the camera. Nothing else works.

## Measurements

The device profiles emulate the viewport, the DPR, touch, and the user agent. They do not emulate a phone GPU.

- "ANGLE Metal" is headless Chromium on an Apple M4 Max GPU. It holds 60 FPS on every run, so it is not a phone proxy.
- "SwiftShader" is a software GPU on the CPU. It is a pessimistic proxy.
- WebKit is not installed. The iPhone 15 profile ran in Chromium.
- Other audit browsers ran at the same time. The load average was 36 to 69.

| GPU | Profile | Orientation | CPU throttle | Tier | FPS median | p95 frame ms | Draw calls | Triangles | Load (1 min) |
|---|---|---|---|---|---|---|---|---|---|
| ANGLE Metal | iPhone 15 | portrait | 1x | low | 59.9 | 16.7 | 45 | 94,606 | 56.6 |
| ANGLE Metal | iPhone 15 | portrait | 1x | high | 59.9 | 16.8 | 189 | 471,248 | 46.3 |
| ANGLE Metal | Pixel 7 | portrait | 4x | low | 59.9 | 16.8 | 45 | 94,606 | 42.7 |
| ANGLE Metal | Pixel 7 | portrait | 4x | high | 59.9 | 16.7 | 186 | 466,992 | 40.0 |
| ANGLE Metal | Pixel 7 | landscape | 4x | high | 59.9 | 16.7 | 250 | 594,574 | 38.1 |
| ANGLE Metal | iPhone 15 | landscape | 1x | high | 59.9 | 16.8 | 240 | 573,482 | 38.1 |
| SwiftShader | Pixel 7 | portrait | 4x | low | 10 | 200 | 41 | 93,550 | 43.3 |
| SwiftShader | Pixel 7 | portrait | 4x | high | 1.2 | 2,399.9 | 149 | 424,905 | 42.9 |
| SwiftShader | iPhone 15 | portrait | 1x | low | 20 | 116.6 | 24 | 59,417 | 46.8 |
| SwiftShader | iPhone 15 | portrait | 1x | high | 1.5 | 3,116.5 | 154 | 427,910 | 44.2 |

The `high` tier has 4 to 5 times the draw calls and the triangles of the `low` tier. A phone GPU gets the `high` tier today, because `qualityFor()` in `src/render/quality.js` gives `low` only to a software renderer.

Note: `__atl.rendererInfo` reports 1 draw call on the `high` tier, because the post passes reset the counter. The table uses the counts from the main pass.

## Load

`vite preview` of `dist/`, Pixel 7 profile, network 9 Mbps down, 1.5 Mbps up, 60 ms RTT.

| CPU throttle | Requests | Transfer | First contentful paint | First game frame | Last network activity |
|---|---|---|---|---|---|
| 1x | 31 | 6.93 MB | 160 ms | 3,214 ms | 7,866 ms |
| 4x | 31 | 6.93 MB | 172 ms | 6,625 ms | 10,737 ms |

The five biggest requests:

1. `skater-*.glb` (Nia): 2,672 kB
2. `main-*.js`: 1,687 kB (the Rapier WASM is inlined)
3. `color-*.jpg`: 422 kB
4. `color-*.jpg`: 392 kB
5. `color-*.jpg`: 280 kB

The game has no load screen.

## Findings

| Id | Sev | Finding | Evidence | Fix | Issue |
|---|---|---|---|---|---|
| MOB-1 | P0 | No touch input exists for push, steer, jump, grind, or dance. A tap, a hold, a swipe, and a swipe up did not move the skater (speed stayed 0.004 m/s). A drag turns only the camera. | `touch.json`, `touch-390x844-after-gestures.jpg`, `touch-844x390-after-gestures.jpg` | Add a touch scheme: a virtual stick and buttons, or auto-push with a tap to jump and a hold to grind | #24 |
| MOB-2 | P0 | A phone GPU gets the `high` tier: 186–250 draw calls and 467k–595k triangles, against 45 calls and 95k triangles on `low`. In SwiftShader, `high` ran at 1.2–1.5 FPS and `low` at 10–20 FPS. | `measurements.json`, `measurements-swiftshader.json` | Add a phone tier (or send touch devices to `low`), and add a frame-time governor that drops the tier | #24 |
| MOB-3 | P1 | All hints are for a keyboard ("Press any key or click", WASD/F/Q/E/H). The shell text covers 13 % of the portrait screen. | `touch-390x844-start.jpg` | Show touch hints on a touch device. Move developer hints behind a flag. | #24 |
| MOB-4 | P1 | At 390x844 the attribution wraps to 3 lines and covers the score. The attribution and the HUD overlap the skater buttons. | `touch-390x844-start.jpg`, `measure-iPhone15-port-default-cpu1x.jpg` | Put the attribution in a corner as one short line with a link | — |
| MOB-5 | P1 | The load is 6.93 MB in 31 requests. On Fast 4G with CPU 4x, the first game frame comes at 6.6 s. There is no load screen. | `load.json`, `load-settled-cpu4x.jpg` | Add a load screen with progress. Load the Rapier WASM as a file. Compress the skater GLB (Draco, KTX2). | — |
| MOB-6 | P1 | In landscape the beat pulse dot is under the Marcus button. | `measure-iPhone15-land-default-cpu1x.jpg` | Move the skater select out of the HUD area | — |
| MOB-7 | P2 | No `viewport-fit=cover`, and no safe-area insets. | `index.html`, `src/shell.css` | Add `viewport-fit=cover` and `env(safe-area-inset-*)` padding | — |
| MOB-8 | P2 | `body` keeps `overscroll-behavior` and `user-select` at `auto`. A swipe can pull to refresh or select text. | `touch.json` | Set `overscroll-behavior: none` and `user-select: none` on the game shell | — |
| MOB-9 | P2 | No fullscreen and no orientation handling. | `index.html`, `src/main.js` | Add a fullscreen button and a "turn your phone" hint if landscape is required | — |
| MOB-10 | P2 | HUD text contrast falls to 1.05–2.65 on bright parts of the scene. Some labels are 11 px. | `touch.json`, `measure-*.jpg` | Put HUD text on a dark pill or add a text outline. Use 14 px minimum. | — |
| MOB-11 | P2 | The game has no reduced-motion option. | `src/main.js` | Read `prefers-reduced-motion` and add an option | — |
| MOB-12 | P2 | The "style ready" cue is only a color change. | `src/ui/hud.js` | Add a shape or a text cue | — |
| MOB-13 | P2 | The skater buttons pass the size check (96x45 px), but a change reloads the whole page. | `touch.json` | Switch the skater without a reload | — |

## Verified

- The touch gestures (tap, hold, swipe, swipe up, drag) on the 390x844 and 844x390 profiles, in Chromium.
- The tier choice, the draw calls, and the triangles for each tier.
- The load size, the request count, and the load times on the emulated network.
- The HUD layout and the overlaps at 390x844 and 844x390.
- A tap starts the audio in Chromium.

## Not verified

- FPS on a real phone GPU.
- All iOS Safari behavior (WebKit is not installed).
- Heat and battery over a long session.
- GPU memory.
